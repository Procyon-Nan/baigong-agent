import { readFirstStreamChunk } from "./http-test-harness";
import {
  assertHttp,
  P4_FAKE_API_KEY,
  requestJson,
  type ManagedUser,
} from "./p4-http-api";

export async function verifyUserHistoryRoutes(
  origin: string,
  cookie: string,
  conversationId: string,
): Promise<void> {
  let result = await requestJson(origin, "/api/conversations", { cookie });
  assertHttp(
    result.response.status === 200 &&
      result.data.items?.some((item) => item.id === conversationId),
    "用户会话列表未返回已完成会话。",
  );

  result = await requestJson(origin, `/api/conversations/${conversationId}`, {
    cookie,
  });
  assertHttp(
    result.response.status === 200 &&
      result.data.conversation?.status === "WAITING" &&
      result.data.context?.kind === "MAIN" &&
      (result.data.messages?.items.length ?? 0) >= 2 &&
      typeof result.data.lastEveCursor === "number",
    "权威会话快照缺少历史消息或持久游标。",
  );
  assertPublicConversationPayload(result.data);

  result = await requestJson(
    origin,
    `/api/conversations/${conversationId}/messages`,
    { cookie },
  );
  assertHttp(
    result.response.status === 200 &&
      result.data.items?.some((item) => item.role === "USER") &&
      result.data.items.some((item) => item.role === "ASSISTANT"),
    "历史消息接口未返回用户与助手消息。",
  );

  result = await requestJson(
    origin,
    `/api/conversations/${conversationId}/nodes`,
    { cookie },
  );
  assertHttp(
    result.response.status === 200 && result.data.items?.length === 1,
    "用户消息位置节点接口返回异常。",
  );

  result = await requestJson(origin, `/api/conversations/${conversationId}`, {
    method: "PATCH",
    cookie,
    headers: { origin },
    body: { title: "P4 已重命名会话" },
  });
  assertHttp(
    result.response.status === 200 &&
      result.data.conversation?.title === "P4 已重命名会话",
    "会话重命名失败。",
  );

  result = await requestJson(
    origin,
    `/api/conversations/${conversationId}/archive`,
    { method: "POST", cookie, headers: { origin } },
  );
  assertHttp(
    result.response.status === 200 &&
      typeof result.data.conversation?.archivedAt === "string",
    "用户归档会话失败。",
  );
  const active = await requestJson(origin, "/api/conversations", { cookie });
  const archived = await requestJson(origin, "/api/conversations?archived=true", {
    cookie,
  });
  assertHttp(
    !active.data.items?.some((item) => item.id === conversationId) &&
      archived.data.items?.some((item) => item.id === conversationId),
    "会话归档列表隔离失败。",
  );

  result = await requestJson(
    origin,
    `/api/conversations/${conversationId}/restore`,
    { method: "POST", cookie, headers: { origin } },
  );
  assertHttp(
    result.response.status === 200 &&
      result.data.conversation?.archivedAt === null,
    "用户恢复归档会话失败。",
  );
}

export async function verifyLocalOwnershipIsolation(
  origin: string,
  adminCookie: string,
  userCookie: string,
  adminConversationId: string,
  userConversationId: string,
): Promise<void> {
  const userOnAdmin = await requestJson(
    origin,
    `/api/conversations/${adminConversationId}`,
    { cookie: userCookie },
  );
  const adminOnUser = await requestJson(
    origin,
    `/api/conversations/${userConversationId}`,
    { cookie: adminCookie },
  );
  const userOnAudit = await requestJson(origin, "/api/admin/conversations", {
    cookie: userCookie,
  });
  assertHttp(
    userOnAdmin.response.status === 404 &&
      adminOnUser.response.status === 404 &&
      userOnAudit.response.status === 403,
    "本地用户所有权或管理员 API 边界失效。",
  );
}

export async function verifyAdminAuditRoutes(
  origin: string,
  adminCookie: string,
  user: ManagedUser,
  conversationId: string,
): Promise<void> {
  let result = await requestJson(
    origin,
    `/api/admin/conversations?userId=${encodeURIComponent(user.id)}&source=LOCAL&archived=all`,
    { cookie: adminCookie },
  );
  assertHttp(
    result.response.status === 200 &&
      result.data.items?.some((item) => item.id === conversationId),
    "管理员会话列表未返回目标用户会话。",
  );

  result = await requestJson(
    origin,
    `/api/admin/conversations/${conversationId}`,
    { cookie: adminCookie },
  );
  assertHttp(
    result.response.status === 200 &&
      result.data.owner?.userId === user.id &&
      (result.data.messages?.items.length ?? 0) >= 2,
    "管理员会话详情缺少所有者或历史消息。",
  );
  assertPublicConversationPayload(result.data);

  result = await requestJson(
    origin,
    `/api/admin/conversations/${conversationId}/execution-index`,
    { cookie: adminCookie },
  );
  assertHttp(
    result.response.status === 200 && Array.isArray(result.data.actions?.items),
    "管理员执行索引接口返回异常。",
  );

  result = await requestJson(
    origin,
    `/api/admin/conversations/${conversationId}/stream-token`,
    { method: "POST", cookie: adminCookie, headers: { origin } },
  );
  const token = result.data.token;
  assertHttp(
    result.response.status === 200 && token,
    "管理员流令牌签发失败。",
  );
  const stream = await fetch(`${origin}/eve/v1/admin/stream?startIndex=0`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assertHttp(stream.status === 200, "管理员原始事件流访问失败。");
  const firstChunk = await readFirstStreamChunk(stream);
  assertHttp(
    firstChunk.length > 0 && !firstChunk.includes(P4_FAKE_API_KEY),
    "管理员原始事件流为空或泄露模型密钥。",
  );
}

export async function verifyEmbeddedHistoryIsolation(
  origin: string,
  adminCookie: string,
  ownerToken: string,
  otherClientToken: string,
  conversationId: string,
): Promise<void> {
  const ownerList = await requestJson(origin, "/api/conversations", {
    authorization: ownerToken,
  });
  const ownerSnapshot = await requestJson(
    origin,
    `/api/conversations/${conversationId}`,
    { authorization: ownerToken },
  );
  const otherClientSnapshot = await requestJson(
    origin,
    `/api/conversations/${conversationId}`,
    { authorization: otherClientToken },
  );
  const adminSnapshot = await requestJson(
    origin,
    `/api/admin/conversations/${conversationId}`,
    { cookie: adminCookie },
  );
  assertHttp(
    ownerList.response.status === 200 &&
      ownerList.data.items?.some((item) => item.id === conversationId) &&
      ownerSnapshot.response.status === 200 &&
      otherClientSnapshot.response.status === 404 &&
      adminSnapshot.response.status === 200 &&
      adminSnapshot.data.owner?.source === "EMBEDDED",
    "嵌入会话历史或跨客户端隔离失败。",
  );
  assertPublicConversationPayload(ownerSnapshot.data);
  assertPublicConversationPayload(adminSnapshot.data);
}

export async function verifyAdminArchive(
  origin: string,
  adminCookie: string,
  userCookie: string,
  conversationId: string,
): Promise<void> {
  const result = await requestJson(
    origin,
    `/api/admin/conversations/${conversationId}/archive`,
    { method: "POST", cookie: adminCookie, headers: { origin } },
  );
  assertHttp(
    result.response.status === 200,
    "管理员归档其他用户会话失败。",
  );
  const archived = await requestJson(origin, "/api/conversations?archived=true", {
    cookie: userCookie,
  });
  assertHttp(
    archived.response.status === 200 &&
      archived.data.items?.some((item) => item.id === conversationId),
    "管理员归档结果未反映到用户归档列表。",
  );
}

function assertPublicConversationPayload(value: unknown): void {
  const serialized = JSON.stringify(value);
  assertHttp(
    !serialized.includes(P4_FAKE_API_KEY) &&
      !serialized.includes("continuationToken") &&
      !serialized.includes("eveSessionId"),
    "P4 会话 HTTP 响应泄露内部凭据或运行时句柄。",
  );
}
