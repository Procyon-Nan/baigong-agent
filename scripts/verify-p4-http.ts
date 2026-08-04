import "dotenv/config";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
  createConversation,
  createEmbeddedSession,
  createManagedUser,
  loginLocalUser,
  modelConfiguration,
  P4_FAKE_API_KEY,
  requestJson,
  waitForConversation,
} from "./support/p4-http-api";
import {
  verifyAdminArchive,
  verifyAdminAuditRoutes,
  verifyEmbeddedHistoryIsolation,
  verifyLocalOwnershipIsolation,
  verifyUserHistoryRoutes,
} from "./support/p4-http-verification";
import {
  cleanupP4TestContext,
  cleanupP4TestDataDirectories,
  configureP4TestDatabase,
  createP4TestContext,
  migrateP4TestDatabase,
  type P4TestContext,
} from "@/tests/support/p4-test-database";

configureP4TestDatabase();

let application: TestApplication | undefined;
let context: P4TestContext | undefined;
let dataDirectory: string | undefined;
let fakeProvider: FakeChatCompletionsServer | undefined;
let verificationFailure: unknown;

try {
  const port = await availableTestPort();
  const origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(join(tmpdir(), "baigong-agent-p4-http-"));
  process.env.BAIGONG_DATA_DIR = dataDirectory;
  process.env.BAIGONG_APP_ORIGIN = origin;
  await migrateP4TestDatabase();
  fakeProvider = await startFakeChatCompletionsServer({
    apiKey: P4_FAKE_API_KEY,
  });
  context = await createP4TestContext("http");
  application = startTestApplication(port, "P4");
  await waitForTestApplication(origin, application);

  const adminCookie = await loginLocalUser(origin, context, {
    identifier: context.administratorUsername,
    password: context.administratorPassword,
    source: "192.0.2.81",
  });
  const configured = await requestJson(origin, "/api/admin/model-config", {
    method: "PUT",
    cookie: adminCookie,
    headers: { origin },
    body: modelConfiguration(fakeProvider.baseUrl),
  });
  assertHttp(
    configured.response.status === 200,
    "P4 假模型配置保存失败。",
  );

  const adminConversation = await createConversation(
    origin,
    { cookie: adminCookie },
    "P4 管理员会话",
  );
  await waitForConversation(
    origin,
    { cookie: adminCookie },
    adminConversation.id,
  );

  const managedUser = await createManagedUser(
    origin,
    adminCookie,
    context,
  );
  const userConversation = await createConversation(
    origin,
    { cookie: managedUser.cookie },
    "P4 用户历史验收",
  );
  await waitForConversation(
    origin,
    { cookie: managedUser.cookie },
    userConversation.id,
  );
  await verifyUserHistoryRoutes(
    origin,
    managedUser.cookie,
    userConversation.id,
  );
  await verifyLocalOwnershipIsolation(
    origin,
    adminCookie,
    managedUser.cookie,
    adminConversation.id,
    userConversation.id,
  );
  await verifyAdminAuditRoutes(
    origin,
    adminCookie,
    managedUser,
    userConversation.id,
  );

  const firstEmbedded = await createEmbeddedSession(
    origin,
    adminCookie,
    context,
    "first",
    "192.0.2.84",
  );
  const secondEmbedded = await createEmbeddedSession(
    origin,
    adminCookie,
    context,
    "second",
    "192.0.2.85",
  );
  const embeddedConversation = await createConversation(
    origin,
    { authorization: firstEmbedded.token },
    "P4 嵌入历史验收",
  );
  await waitForConversation(
    origin,
    { authorization: firstEmbedded.token },
    embeddedConversation.id,
  );
  await verifyEmbeddedHistoryIsolation(
    origin,
    adminCookie,
    firstEmbedded.token,
    secondEmbedded.token,
    embeddedConversation.id,
  );
  await verifyAdminArchive(
    origin,
    adminCookie,
    managedUser.cookie,
    userConversation.id,
  );

  assertHttp(
    !JSON.stringify(configured.data).includes(P4_FAKE_API_KEY),
    "P4 HTTP 响应泄露模型 API Key。",
  );
  console.info(
    JSON.stringify({
      testSuffix: context.suffix,
      userHistoryAndNodes: "ok",
      renameArchiveRestore: "ok",
      localOwnershipIsolation: "ok",
      embeddedClientIsolation: "ok",
      adminAuditAndRawStream: "ok",
      responseSecrets: "not-exposed",
    }),
  );
} catch (error) {
  const applicationOutput = application?.output.join("").trim();
  verificationFailure = applicationOutput
    ? new Error(
        `${error instanceof Error ? error.message : String(error)}\n\nP4 测试应用输出：\n${applicationOutput}`,
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
    () => (context ? cleanupP4TestContext(context) : undefined),
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
  await runCleanupStep(cleanupP4TestDataDirectories, cleanupFailures);
  const failures = [
    ...(verificationFailure === undefined ? [] : [verificationFailure]),
    ...cleanupFailures,
  ];
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "P4 HTTP 验收或清理失败。");
  }
}
