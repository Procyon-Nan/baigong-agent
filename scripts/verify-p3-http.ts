import "dotenv/config";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/src/server/db/client";
import { conversations } from "@/src/server/db/schema";
import {
  FAKE_CHAT_MODELS,
  startFakeChatCompletionsServer,
  type FakeChatCompletionsServer,
} from "./support/fake-chat-completions";
import {
  availableTestPort,
  readFirstStreamChunk,
  runCleanupStep,
  startTestApplication,
  stopTestApplication,
  type TestApplication,
  waitForTestApplication,
} from "./support/p3-http-harness";
import {
  cleanupP3TestContext,
  configureP3TestDatabase,
  createP3TestContext,
  migrateP3TestDatabase,
  type P3TestContext,
} from "@/tests/support/p3-test-database";

configureP3TestDatabase();

const fakeApiKey = "p3-local-fake-provider-key";
let context: P3TestContext | undefined;
let fakeProvider: FakeChatCompletionsServer | undefined;
let application: TestApplication | undefined;
let dataDirectory: string | undefined;
let verificationFailure: unknown;

try {
  const port = await availableTestPort();
  const origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(join(tmpdir(), "baigong-agent-p3-http-"));
  process.env.BAIGONG_DATA_DIR = dataDirectory;
  process.env.BAIGONG_APP_ORIGIN = origin;
  await migrateP3TestDatabase();
  fakeProvider = await startFakeChatCompletionsServer({ apiKey: fakeApiKey });
  await verifyFakeProviderModes(fakeProvider);
  context = await createP3TestContext("http");
  application = startTestApplication(port);
  await waitForTestApplication(origin, application);

  const adminSource = "192.0.2.73";
  context.loginSources.add(adminSource);
  context.loginIdentifiers.add(context.administratorUsername);
  const login = await requestJson(origin, "/api/auth/local-login", {
    method: "POST",
    body: {
      identifier: context.administratorUsername,
      password: context.administratorPassword,
    },
    headers: { origin, "x-real-ip": adminSource },
  });
  assert(login.response.status === 200, "P3 管理员登录失败。");
  const adminCookie = login.response.headers.get("set-cookie");
  assert(adminCookie, "P3 管理员登录未返回 Cookie。");

  let result = await requestJson(origin, "/api/admin/model-config", {
    method: "PUT",
    cookie: adminCookie,
    headers: { origin },
    body: modelConfiguration(fakeProvider.baseUrl),
  });
  assert(result.response.status === 200, "模型配置保存失败。");
  assert(
    !JSON.stringify(result.data).includes(fakeApiKey),
    "模型配置响应泄露 API Key。",
  );
  const modelConfigVersionId = result.data.configuration?.id;
  assert(modelConfigVersionId, "模型配置响应缺少版本标识。");

  result = await requestJson(origin, "/api/admin/model-config/test", {
    method: "POST",
    cookie: adminCookie,
    headers: { origin },
    body: modelConfiguration(fakeProvider.baseUrl),
  });
  assert(result.response.status === 200, "假的模型连通性测试失败。");
  assert(
    result.data.result?.output === "P3 fake response",
    "模型连通性测试未返回假的模型输出。",
  );

  const anonymousEve = await fetch(`${origin}/eve/v1/info`, {
    redirect: "manual",
  });
  assert(anonymousEve.status === 401, "匿名请求可直接访问 eve 标准路由。");

  const localRequestId = crypto.randomUUID();
  const localSubmission = await requestJson(origin, "/api/conversations", {
    method: "POST",
    cookie: adminCookie,
    headers: { origin },
    body: { message: "P3 本地 HTTP 验收", requestId: localRequestId },
  });
  assert(localSubmission.response.status === 201, "本地会话创建失败。");
  const localConversation = localSubmission.data.conversation;
  const localTurn = localSubmission.data.turn;
  assert(localConversation?.id && localTurn?.id, "本地会话响应缺少标识。");

  const duplicate = await requestJson(origin, "/api/conversations", {
    method: "POST",
    cookie: adminCookie,
    headers: { origin },
    body: { message: "不得重复执行", requestId: localRequestId },
  });
  assert(
    duplicate.response.status === 200 && duplicate.data.duplicate === true,
    "创建请求的 requestId 幂等恢复失败。",
  );
  await waitForConversation(origin, adminCookie, localConversation.id);

  const failedRequestCount =
    fakeProvider.requests.get(FAKE_CHAT_MODELS.error) ?? 0;
  result = await requestJson(origin, "/api/admin/model-config", {
    method: "PUT",
    cookie: adminCookie,
    headers: { origin },
    body: modelConfiguration(fakeProvider.baseUrl, FAKE_CHAT_MODELS.error),
  });
  assert(result.response.status === 200, "错误模型配置保存失败。");
  const failedSubmission = await requestJson(origin, "/api/conversations", {
    method: "POST",
    cookie: adminCookie,
    headers: { origin },
    body: {
      message: "P3 模型失败恢复验收",
      requestId: crypto.randomUUID(),
    },
  });
  const failedConversation = failedSubmission.data.conversation;
  assert(
    failedSubmission.response.status === 201 && failedConversation?.id,
    "错误模型会话创建失败。",
  );
  await waitForConversation(origin, adminCookie, failedConversation.id);
  assert(
    (fakeProvider.requests.get(FAKE_CHAT_MODELS.error) ?? 0) -
      failedRequestCount ===
      3,
    "交互式模型错误未统一执行三次尝试。",
  );

  result = await requestJson(origin, "/api/admin/model-config", {
    method: "PUT",
    cookie: adminCookie,
    headers: { origin },
    body: modelConfiguration(fakeProvider.baseUrl),
  });
  assert(result.response.status === 200, "恢复模型配置保存失败。");
  const recoveredSubmission = await requestJson(
    origin,
    `/api/conversations/${failedConversation.id}/messages`,
    {
      method: "POST",
      cookie: adminCookie,
      headers: { origin },
      body: {
        message: "继续原会话",
        requestId: crypto.randomUUID(),
      },
    },
  );
  assert(
    recoveredSubmission.response.status === 200 &&
      recoveredSubmission.data.conversation?.id === failedConversation.id,
    "修复模型配置后未能继续原会话。",
  );
  await waitForConversation(origin, adminCookie, failedConversation.id);

  const { issueEveServiceToken } = await import("@/src/server/eve/tokens");
  const serviceToken = await issueEveServiceToken({
    userId: context.administratorId,
    tenantId: context.tenantId,
    role: "ADMIN",
    source: "LOCAL",
    conversationId: localConversation.id,
    turnId: localTurn.id,
    modelConfigVersionId,
  });
  const serviceOnAdminStream = await fetch(
    `${origin}/eve/v1/admin/stream?startIndex=0`,
    { headers: { authorization: `Bearer ${serviceToken.token}` } },
  );
  assert(
    serviceOnAdminStream.status === 401,
    "BFF 服务 JWT 可被管理员原始流错误接受。",
  );

  const adminTokenResponse = await requestJson(
    origin,
    `/api/admin/conversations/${localConversation.id}/stream-token`,
    { method: "POST", cookie: adminCookie, headers: { origin } },
  );
  const adminStreamToken = adminTokenResponse.data.token;
  assert(
    adminTokenResponse.response.status === 200 && adminStreamToken,
    "管理员原始流令牌签发失败。",
  );
  const adminOnStandardEve = await fetch(`${origin}/eve/v1/info`, {
    headers: { authorization: `Bearer ${adminStreamToken}` },
  });
  assert(
    adminOnStandardEve.status === 401,
    "管理员原始流 JWT 可被 eve 标准路由错误接受。",
  );
  const adminRawStream = await fetch(
    `${origin}/eve/v1/admin/stream?startIndex=0`,
    { headers: { authorization: `Bearer ${adminStreamToken}` } },
  );
  assert(adminRawStream.status === 200, "管理员原始事件流访问失败。");
  const rawText = await readFirstStreamChunk(adminRawStream);
  assert(rawText.length > 0, "管理员原始事件流为空。");
  assert(!rawText.includes(fakeApiKey), "管理员原始事件流泄露 API Key。");

  result = await requestJson(origin, "/api/admin/model-config", {
    method: "PUT",
    cookie: adminCookie,
    headers: { origin },
    body: modelConfiguration(fakeProvider.baseUrl, FAKE_CHAT_MODELS.timeout),
  });
  assert(result.response.status === 200, "取消验收模型配置保存失败。");

  const embedded = await createEmbeddedSession(
    origin,
    adminCookie,
    context,
  );
  const embeddedSubmission = await requestJson(origin, "/api/conversations", {
    method: "POST",
    headers: {
      origin,
      authorization: `Bearer ${embedded.token}`,
    },
    body: {
      message: "P3 嵌入 HTTP 验收",
      requestId: crypto.randomUUID(),
    },
  });
  assert(
    embeddedSubmission.response.status === 201 &&
      embeddedSubmission.data.conversation?.id,
    "嵌入 Bearer 未能使用统一对话服务。",
  );
  const embeddedAdminAttempt = await requestJson(
    origin,
    `/api/admin/conversations/${localConversation.id}/stream-token`,
    {
      method: "POST",
      headers: { origin, authorization: `Bearer ${embedded.token}` },
    },
  );
  assert(
    embeddedAdminAttempt.response.status === 403,
    "普通嵌入用户可签发管理员原始流令牌。",
  );
  const embeddedDirectEve = await fetch(`${origin}/eve/v1/info`, {
    headers: { authorization: `Bearer ${embedded.token}` },
  });
  assert(
    embeddedDirectEve.status === 401,
    "普通嵌入用户可直接访问 eve 标准路由。",
  );
  const embeddedDirectAdminStream = await fetch(
    `${origin}/eve/v1/admin/stream?startIndex=0`,
    { headers: { authorization: `Bearer ${embedded.token}` } },
  );
  assert(
    embeddedDirectAdminStream.status === 401,
    "普通嵌入用户可直接访问管理员原始流。",
  );

  const disabled = await requestJson(
    origin,
    `/api/admin/integrations/${embedded.integrationId}`,
    {
      method: "PATCH",
      cookie: adminCookie,
      headers: { origin },
      body: { status: "DISABLED" },
    },
  );
  assert(disabled.response.status === 200, "嵌入客户端停用失败。");
  await waitForStoredConversation(
    embeddedSubmission.data.conversation.id,
    "WAITING",
  );
  const revokedConversation = await requestJson(
    origin,
    `/api/conversations/${embeddedSubmission.data.conversation.id}`,
    { headers: { authorization: `Bearer ${embedded.token}` } },
  );
  assert(
    revokedConversation.response.status === 401,
    "嵌入客户端停用后会话身份仍然有效。",
  );

  const serializedResponses = JSON.stringify([
    login.data,
    result.data,
    localSubmission.data,
    duplicate.data,
    failedSubmission.data,
    recoveredSubmission.data,
    embeddedSubmission.data,
  ]);
  assert(
    !serializedResponses.includes(fakeApiKey),
    "普通 HTTP 响应泄露 API Key。",
  );
  assert(
    !serializedResponses.includes("continuationToken"),
    "普通 HTTP 响应泄露 continuation token。",
  );

  console.info(
    JSON.stringify({
      testSuffix: context.suffix,
      fakeProvider: "all-modes-verified",
      localCookieConversation: "ok",
      embeddedBearerConversation: "ok",
      requestIdRecovery: "ok",
      modelFailureRecovery: "same-session",
      directEveAccess: "closed",
      tokenAudiences: "isolated",
      adminRawStream: "scoped",
      embeddedRevocation: "closed",
      embeddedActiveReplyCancellation: "settled",
      responseSecrets: "not-exposed",
    }),
  );
} catch (error) {
  const applicationOutput = application?.output.join("").trim();
  const providerRequests = fakeProvider
    ? JSON.stringify(Object.fromEntries(fakeProvider.requests))
    : "unavailable";
  verificationFailure = applicationOutput
    ? new Error(
        `${error instanceof Error ? error.message : String(error)}\n\n假的模型请求计数：${providerRequests}\n\nP3 测试应用输出：\n${applicationOutput}`,
        { cause: error },
      )
    : error;
} finally {
  const cleanupFailures: unknown[] = [];
  await runCleanupStep(
    () => (application ? stopTestApplication(application) : undefined),
    cleanupFailures,
  );
  await runCleanupStep(
    () => (context ? cleanupP3TestContext(context) : undefined),
    cleanupFailures,
  );
  await runCleanupStep(
    async () => {
      const { closeDatabase } = await import("@/src/server/db/client");
      await closeDatabase();
    },
    cleanupFailures,
  );
  await runCleanupStep(
    () => (fakeProvider ? fakeProvider.close() : undefined),
    cleanupFailures,
  );
  await runCleanupStep(
    () =>
      dataDirectory
        ? rm(dataDirectory, { recursive: true, force: true })
        : undefined,
    cleanupFailures,
  );
  const failures = [
    ...(verificationFailure === undefined ? [] : [verificationFailure]),
    ...cleanupFailures,
  ];
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "P3 HTTP 验收或清理失败。");
  }
}

type ApiData = {
  readonly error?: { readonly code?: string; readonly message?: string };
  readonly configuration?: { readonly id?: string };
  readonly result?: { readonly output?: string };
  readonly clientSecret?: string;
  readonly client?: { readonly id: string; readonly clientId: string };
  readonly ticket?: string;
  readonly token?: string;
  readonly duplicate?: boolean;
  readonly conversation?: { readonly id: string; readonly status?: string };
  readonly turn?: { readonly id: string };
};

function modelConfiguration(
  baseUrl: string,
  modelName: string = FAKE_CHAT_MODELS.streaming,
) {
  return {
    providerDisplayName: "P3 Local Fake Provider",
    baseUrl,
    modelName,
    contextWindowTokens: 8_192,
    apiKey: fakeApiKey,
  };
}

async function requestJson(
  origin: string,
  path: string,
  options: {
    readonly method?: string;
    readonly cookie?: string;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
  } = {},
): Promise<{ readonly response: Response; readonly data: ApiData }> {
  const response = await fetch(`${origin}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const text = await response.text();
  let data: ApiData = {};
  try {
    data = text ? (JSON.parse(text) as ApiData) : {};
  } catch {
    throw new Error(
      `接口 ${path} 返回了非 JSON 响应（状态 ${response.status}）。`,
    );
  }
  return { response, data };
}

async function createEmbeddedSession(
  origin: string,
  adminCookie: string,
  context: P3TestContext,
): Promise<{ readonly token: string; readonly integrationId: string }> {
  let result = await requestJson(origin, "/api/admin/integrations", {
    method: "POST",
    cookie: adminCookie,
    headers: { origin },
    body: {
      name: `P3 HTTP Host ${context.suffix}`,
      allowedOrigins: ["http://localhost:4100"],
    },
  });
  const client = result.data.client;
  const clientSecret = result.data.clientSecret;
  assert(
    result.response.status === 201 && client && clientSecret,
    "嵌入客户端创建失败。",
  );

  const ticketSource = "192.0.2.74";
  context.loginSources.add(`embedded-client:${ticketSource}`);
  const basic = Buffer.from(`${client.clientId}:${clientSecret}`).toString(
    "base64",
  );
  result = await requestJson(origin, "/api/embed/tickets", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "x-real-ip": ticketSource,
    },
    body: {
      externalUserId: `p3-http-${context.suffix}`,
      origin: "http://localhost:4100",
      displayName: "P3 Embedded Test",
    },
  });
  assert(
    result.response.status === 201 && result.data.ticket,
    "嵌入票据签发失败。",
  );
  result = await requestJson(origin, "/api/embed/exchange", {
    method: "POST",
    body: { ticket: result.data.ticket, origin: "http://localhost:4100" },
  });
  assert(
    result.response.status === 200 && result.data.token,
    "嵌入票据兑换失败。",
  );
  return { token: result.data.token, integrationId: client.id };
}

async function waitForConversation(
  origin: string,
  cookie: string,
  conversationId: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await requestJson(
      origin,
      `/api/conversations/${conversationId}`,
      { cookie },
    );
    if (result.data.conversation?.status === "WAITING") return;
    if (result.data.conversation?.status?.startsWith("TERMINAL_")) {
      throw new Error(`会话意外终止：${result.data.conversation.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("等待假的模型回复完成超时。");
}

async function waitForStoredConversation(
  conversationId: string,
  expectedStatus: "WAITING",
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const [conversation] = await getDatabase()
      .select({ status: conversations.status })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (conversation?.status === expectedStatus) return;
    if (conversation?.status.startsWith("TERMINAL_")) {
      throw new Error(`身份变化取消导致会话意外终止：${conversation.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("等待身份变化取消完成超时。");
}

async function verifyFakeProviderModes(
  server: FakeChatCompletionsServer,
): Promise<void> {
  const request = (model: string, stream = false, signal?: AbortSignal) =>
    fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fakeApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "test" }],
        stream,
      }),
      signal,
    });

  const unauthorized = await fetch(`${server.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: FAKE_CHAT_MODELS.success, messages: [] }),
  });
  assert(unauthorized.status === 401, "假服务未验证可选 API Key。");
  assert(
    (await request(FAKE_CHAT_MODELS.success)).status === 200,
    "假服务非流式响应失败。",
  );
  const stream = await request(FAKE_CHAT_MODELS.streaming, true);
  assert(
    (await stream.text()).includes("data: [DONE]"),
    "假服务流式增量响应失败。",
  );
  await request(FAKE_CHAT_MODELS.partialFailure, true)
    .then((partial) => partial.text())
    .then(
      () => {
        throw new Error("假服务部分输出失败未中断连接。");
      },
      () => undefined,
    );
  assert(
    (await request(FAKE_CHAT_MODELS.retry)).status === 503,
    "假服务首次重试响应错误。",
  );
  assert(
    (await request(FAKE_CHAT_MODELS.retry)).status === 503,
    "假服务第二次重试响应错误。",
  );
  assert(
    (await request(FAKE_CHAT_MODELS.retry)).status === 200,
    "假服务重试恢复失败。",
  );
  assert(
    (await request(FAKE_CHAT_MODELS.error)).status === 400,
    "假服务错误体响应失败。",
  );
  await request(
    FAKE_CHAT_MODELS.timeout,
    false,
    AbortSignal.timeout(50),
  ).then(
    () => {
      throw new Error("假服务超时模式未等待客户端取消。");
    },
    () => undefined,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
