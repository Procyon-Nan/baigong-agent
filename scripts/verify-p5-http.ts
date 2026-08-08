import "dotenv/config";

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FAKE_CHAT_MODELS,
  startFakeChatCompletionsServer,
  type FakeChatCompletionsServer,
} from "./support/fake-chat-completions";
import {
  availableTestPort,
  runCleanupStep,
  startTestApplication,
  stopTestApplication,
  type TestApplication,
  waitForTestApplication,
} from "./support/http-test-harness";
import {
  assertHttp,
  loginLocalUser,
  P4_FAKE_API_KEY,
  requestJson,
  waitForConversation,
} from "./support/p4-http-api";
import {
  cleanupP5TestContext,
  cleanupP5TestDataDirectories,
  configureP5TestDatabase,
  createP5TestContext,
  migrateP5TestDatabase,
  type P5TestContext,
} from "@/tests/support/p5-test-database";

configureP5TestDatabase();

let application: TestApplication | undefined;
let context: P5TestContext | undefined;
let dataDirectory: string | undefined;
let fakeProvider: FakeChatCompletionsServer | undefined;
let verificationFailure: unknown;

try {
  const dependencyFilesBefore = await readDependencyFiles();
  const port = await availableTestPort();
  const origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(join(tmpdir(), "baigong-agent-p5-http-"));
  process.env.BAIGONG_DATA_DIR = dataDirectory;
  process.env.BAIGONG_APP_ORIGIN = origin;
  await migrateP5TestDatabase();
  fakeProvider = await startFakeChatCompletionsServer({
    apiKey: P4_FAKE_API_KEY,
  });
  context = await createP5TestContext("http");
  application = startTestApplication(port, "P5");
  await waitForTestApplication(origin, application);

  const adminCookie = await loginLocalUser(origin, context, {
    identifier: context.administratorUsername,
    password: context.administratorPassword,
    source: "192.0.2.85",
  });
  await saveModelConfiguration(
    origin,
    adminCookie,
    fakeProvider,
    FAKE_CHAT_MODELS.streaming,
  );
  const upload = await uploadImage(
    origin,
    adminCookie,
    "http-test.png",
    new Uint8Array([1, 2, 3, 4]),
  );

  const submission = await requestJson(origin, "/api/conversations", {
    method: "POST",
    cookie: adminCookie,
    headers: { origin },
    body: {
      message: "",
      requestId: crypto.randomUUID(),
      attachmentIds: [upload.attachment.id],
    },
  });
  const conversationId = submission.data.conversation?.id;
  assertHttp(
    submission.response.status === 201 && conversationId,
    `P5 仅附件会话创建失败（状态 ${submission.response.status}，错误 ${submission.data.error?.code ?? "unknown"}：${submission.data.error?.message ?? "无"}）。`,
  );
  await waitForConversation(origin, { cookie: adminCookie }, conversationId);
  const directObservations =
    fakeProvider.observations.get(FAKE_CHAT_MODELS.streaming) ?? [];
  assertHttp(
    directObservations.length === 1 &&
      directObservations[0]?.stream === true &&
      directObservations[0].hasImageDataUrl,
    "P5 当前图片未通过唯一一次流式请求直接到达模型提供商。",
  );
  const directEvents = await readConversationEventTypes(
    origin,
    adminCookie,
    conversationId,
  );
  assertNoSyntheticOrCompactionEvents(directEvents, "当前图片");
  assertHttp(
    JSON.stringify(await readDependencyFiles()) ===
      JSON.stringify(dependencyFilesBefore),
    "P5 会话运行期间修改了项目依赖文件。",
  );
  assertHttp(
    !/(opening sandbox|sandbox template|microsandbox|just-bash)/i.test(
      application.output.join(""),
    ),
    "P5 会话意外启动或准备了 Sandbox 后端。",
  );

  const history = await requestJson(
    origin,
    `/api/conversations/${conversationId}/messages`,
    { cookie: adminCookie },
  );
  const historyText = JSON.stringify(history.data);
  assertHttp(
    history.response.status === 200 &&
      historyText.includes("http-test.png") &&
      !historyText.includes(dataDirectory),
    "P5 附件历史投影无效或泄露本地路径。",
  );
  const preview = await fetch(
    `${origin}/api/attachments/${upload.attachment.id}`,
    { headers: { cookie: adminCookie } },
  );
  assertHttp(
    preview.status === 200 &&
      preview.headers.get("content-type") === "image/png" &&
      preview.headers.get("x-content-type-options") === "nosniff" &&
      (await preview.arrayBuffer()).byteLength === 4,
    "P5 附件鉴权预览失败。",
  );
  const deleteBound = await fetch(
    `${origin}/api/attachments/${upload.attachment.id}`,
    { method: "DELETE", headers: { cookie: adminCookie, origin } },
  );
  assertHttp(deleteBound.status === 404, "P5 已绑定附件仍可被独立删除。");

  await saveModelConfiguration(
    origin,
    adminCookie,
    fakeProvider,
    FAKE_CHAT_MODELS.attachmentTools,
  );
  const toolUpload = await uploadImage(
    origin,
    adminCookie,
    "tool-read-test.png",
    new Uint8Array([5, 6, 7, 8]),
  );
  const toolSubmission = await requestJson(origin, "/api/conversations", {
    method: "POST",
    cookie: adminCookie,
    headers: { origin },
    body: {
      message: "请通过会话附件工具重新读取这张图片。",
      requestId: crypto.randomUUID(),
      attachmentIds: [toolUpload.attachment.id],
    },
  });
  const toolConversationId = toolSubmission.data.conversation?.id;
  assertHttp(
    toolSubmission.response.status === 201 && toolConversationId,
    "P5 附件 Tool 回读会话创建失败。",
  );
  await waitForConversation(
    origin,
    { cookie: adminCookie },
    toolConversationId,
  );
  const toolObservations =
    fakeProvider.observations.get(FAKE_CHAT_MODELS.attachmentTools) ?? [];
  assertHttp(
    toolObservations.length === 3 &&
      toolObservations.every((observation) => observation.stream) &&
      toolObservations[2]?.hasImageDataUrl === true &&
      toolObservations.every(
        (observation) => !observation.toolRoleContainsDataUrl,
      ),
    "P5 附件 Tool 未以三个必要流式 Step 和真实多模态 part 完成回读。",
  );
  const toolEvents = await readConversationEventTypes(
    origin,
    adminCookie,
    toolConversationId,
  );
  assertNoSyntheticOrCompactionEvents(toolEvents, "附件 Tool 回读");
  console.info(
    JSON.stringify({
      testSuffix: context.suffix,
      attachmentUpload: "ok",
      attachmentOnlyMessage: "ok",
      directMultimodalRequest: "one-stream-step",
      attachmentToolMultimodalProjection: "three-stream-steps",
      syntheticUserEvents: "none",
      safeHistoryProjection: "ok",
      authenticatedPreview: "ok",
      boundAttachmentImmutable: "ok",
    }),
  );
} catch (error) {
  const applicationOutput = application?.output.join("").trim();
  const providerRequests = fakeProvider
    ? JSON.stringify(Object.fromEntries(fakeProvider.requests))
    : "unavailable";
  verificationFailure = new Error(
    [
      error instanceof Error ? error.message : String(error),
      `假的模型请求计数：${providerRequests}`,
      ...(applicationOutput ? [`P5 测试应用输出：\n${applicationOutput}`] : []),
    ].join("\n\n"),
    { cause: error },
  );
} finally {
  const cleanupFailures: unknown[] = [];
  await runCleanupStep(
    () => (application ? stopTestApplication(application) : undefined),
    cleanupFailures,
  );
  await runCleanupStep(
    () => (context ? cleanupP5TestContext(context) : undefined),
    cleanupFailures,
  );
  await runCleanupStep(async () => {
    const { closeDatabase } = await import("@/src/server/db/client");
    await closeDatabase();
  }, cleanupFailures);
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
  await runCleanupStep(cleanupP5TestDataDirectories, cleanupFailures);
  const failures = [
    ...(verificationFailure === undefined ? [] : [verificationFailure]),
    ...cleanupFailures,
  ];
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "P5 HTTP 验收或清理失败。");
  }
}

async function readDependencyFiles(): Promise<{
  readonly packageJson: string;
  readonly packageLock: string;
}> {
  const [packageJson, packageLock] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("package-lock.json", "utf8"),
  ]);
  return { packageJson, packageLock };
}

async function saveModelConfiguration(
  origin: string,
  adminCookie: string,
  provider: FakeChatCompletionsServer,
  modelName: string,
): Promise<void> {
  const result = await requestJson(origin, "/api/admin/model-config", {
    method: "PUT",
    cookie: adminCookie,
    headers: { origin },
    body: {
      providerDisplayName: "P5 Local Fake Provider",
      baseUrl: provider.baseUrl,
      modelName,
      contextWindowTokens: 8_192,
      supportsImageInput: true,
      supportsNativePdfInput: false,
      apiKey: P4_FAKE_API_KEY,
    },
  });
  assertHttp(result.response.status === 200, "P5 假模型配置保存失败。");
}

async function uploadImage(
  origin: string,
  cookie: string,
  filename: string,
  bytes: Uint8Array,
): Promise<{ readonly attachment: { readonly id: string } }> {
  const form = new FormData();
  form.set("requestId", crypto.randomUUID());
  form.set(
    "file",
    new File([new Uint8Array(bytes)], filename, { type: "image/png" }),
  );
  const response = await fetch(`${origin}/api/attachments`, {
    method: "POST",
    headers: { cookie, origin },
    body: form,
  });
  const body: unknown = await response.json();
  const attachmentId = readAttachmentId(body);
  assertHttp(
    response.status === 201 && attachmentId,
    `P5 附件 ${filename} 上传失败。`,
  );
  return { attachment: { id: attachmentId } };
}

function readAttachmentId(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.attachment)) return null;
  return typeof value.attachment.id === "string" ? value.attachment.id : null;
}

async function readConversationEventTypes(
  origin: string,
  adminCookie: string,
  conversationId: string,
): Promise<string[]> {
  const tokenResponse = await requestJson(
    origin,
    `/api/admin/conversations/${conversationId}/stream-token`,
    { method: "POST", cookie: adminCookie, headers: { origin } },
  );
  const token = tokenResponse.data.token;
  assertHttp(
    tokenResponse.response.status === 200 && token,
    "P5 管理员原始流令牌签发失败。",
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(
      `${origin}/eve/v1/admin/stream?startIndex=0`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
    assertHttp(
      response.status === 200 && response.body,
      "P5 管理员原始事件流访问失败。",
    );
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    const eventTypes: string[] = [];
    let remainder = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const lines = `${remainder}${decoder.decode(chunk.value, { stream: true })}`.split(
        "\n",
      );
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        const type = readEventType(line);
        if (!type) continue;
        eventTypes.push(type);
        if (type === "session.waiting") return eventTypes;
      }
    }
    throw new Error("P5 管理员原始事件流未到达 session.waiting。");
  } finally {
    clearTimeout(timeout);
    await reader?.cancel().catch(() => undefined);
  }
}

function readEventType(line: string): string | null {
  if (!line.trim()) return null;
  const value: unknown = JSON.parse(line);
  return isRecord(value) && typeof value.type === "string" ? value.type : null;
}

function assertNoSyntheticOrCompactionEvents(
  eventTypes: readonly string[],
  scenario: string,
): void {
  assertHttp(
    eventTypes.filter((type) => type === "message.received").length === 1,
    `P5 ${scenario}产生了额外的 synthetic 用户事件。`,
  );
  assertHttp(
    !eventTypes.some(
      (type) =>
        type === "compaction.requested" || type === "compaction.completed",
    ),
    `P5 ${scenario}在模型回复前意外触发了上下文压缩。`,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
