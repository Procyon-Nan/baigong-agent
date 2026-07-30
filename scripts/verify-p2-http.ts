import "dotenv/config";

import { closeDatabase } from "@/src/server/db/client";
import { createLocalUser } from "@/src/server/users/service";

const origin = process.env.P2_HTTP_BASE_URL ?? "http://localhost:3000";

type JsonResult = {
  response: Response;
  data: ApiData;
};

type ApiData = {
  readonly error?: { readonly code?: string; readonly message?: string };
  readonly temporaryPassword?: string;
  readonly clientSecret?: string;
  readonly client?: { readonly id: string; readonly clientId: string };
  readonly ticket?: string;
  readonly token?: string;
  readonly text?: string;
};

async function requestJson(
  path: string,
  options: {
    method?: string;
    cookie?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<JsonResult> {
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
    data = { text };
  }
  return { response, data };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  const initialAdministrator = await createLocalUser({
    username: "http-admin",
    email: "http-admin@example.com",
    displayName: "HTTP Admin",
    role: "ADMIN",
  });
  let result = await requestJson("/api/auth/local-login", {
    method: "POST",
    body: {
      identifier: "HTTP-ADMIN",
      password: initialAdministrator.temporaryPassword,
    },
    headers: { origin, "x-real-ip": "192.0.2.21" },
  });
  assert(
    result.response.status === 200,
    `管理员登录失败：${result.response.status}`,
  );
  const adminCookie = result.response.headers.get("set-cookie");
  assert(adminCookie, "管理员登录未返回会话 Cookie。");

  let page = await fetch(`${origin}/`, {
    headers: { cookie: adminCookie },
    redirect: "manual",
  });
  assert(
    page.status === 307 && page.headers.get("location") === "/change-password",
    "首次登录未强制跳转修改密码。",
  );
  result = await requestJson("/api/auth/change-password", {
    method: "POST",
    cookie: adminCookie,
    body: {
      currentPassword: initialAdministrator.temporaryPassword,
      newPassword: "http admin secure password",
    },
    headers: { origin },
  });
  assert(result.response.status === 200, "管理员首次修改密码失败。");

  result = await requestJson("/api/admin/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      username: "http-user",
      email: "http-user@example.com",
      displayName: "HTTP User",
      role: "USER",
    },
    headers: { origin },
  });
  assert(
    result.response.status === 201 &&
      typeof result.data.temporaryPassword === "string" &&
      result.response.headers.get("cache-control") === "no-store",
    "普通用户创建或临时密码保护失败。",
  );
  const userPassword = result.data.temporaryPassword as string;
  const userLogin = await requestJson("/api/auth/local-login", {
    method: "POST",
    body: { identifier: "http-user@example.com", password: userPassword },
    headers: { origin, "x-real-ip": "192.0.2.22" },
  });
  assert(userLogin.response.status === 200, "普通用户登录失败。");
  const userCookie = userLogin.response.headers.get("set-cookie");
  assert(userCookie, "普通用户登录未返回会话 Cookie。");
  result = await requestJson("/api/auth/change-password", {
    method: "POST",
    cookie: userCookie,
    body: {
      currentPassword: userPassword,
      newPassword: "http user secure password",
    },
    headers: { origin },
  });
  assert(result.response.status === 200, "普通用户首次修改密码失败。");
  result = await requestJson("/api/admin/users", { cookie: userCookie });
  assert(
    result.response.status === 403 &&
      result.data.error?.code === "ADMIN_REQUIRED",
    "普通用户管理 API 权限控制失败。",
  );

  result = await requestJson("/api/admin/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      username: "csrf-user",
      email: "csrf@example.com",
      displayName: "CSRF",
      role: "USER",
    },
  });
  assert(
    result.response.status === 403 &&
      result.data.error?.code === "INVALID_REQUEST_ORIGIN",
    "同源请求保护失败。",
  );

  result = await requestJson("/api/admin/integrations", {
    method: "POST",
    cookie: adminCookie,
    body: { name: "HTTP Host", allowedOrigins: ["http://localhost:4100"] },
    headers: { origin },
  });
  assert(
    result.response.status === 201 &&
      typeof result.data.clientSecret === "string",
    "嵌入客户端创建失败。",
  );
  const client = result.data.client;
  const clientSecret = result.data.clientSecret;
  assert(client && clientSecret, "嵌入客户端响应缺少客户端凭据。");
  const clientList = await requestJson("/api/admin/integrations", {
    cookie: adminCookie,
  });
  const serializedClientList = JSON.stringify(clientList.data);
  assert(
    !serializedClientList.includes(clientSecret) &&
      !serializedClientList.includes("secretHash"),
    "客户端列表泄露了密钥材料。",
  );

  const authorization = `Basic ${Buffer.from(`${client.clientId}:${clientSecret}`).toString("base64")}`;
  result = await requestJson("/api/embed/tickets", {
    method: "POST",
    body: {
      externalUserId: "http-external",
      origin: "http://localhost:4100",
      displayName: "HTTP Embedded",
      displayEmail: "http-admin@example.com",
    },
    headers: { authorization, "x-real-ip": "192.0.2.23" },
  });
  assert(
    result.response.status === 201 &&
      typeof result.data.ticket === "string" &&
      result.response.headers.get("cache-control") === "no-store",
    "一次性票据签发失败。",
  );
  const firstTicket = result.data.ticket as string;
  result = await requestJson("/api/embed/exchange", {
    method: "POST",
    body: { ticket: firstTicket, origin: "http://localhost:4100" },
  });
  assert(
    result.response.status === 200 &&
      typeof result.data.token === "string" &&
      result.response.headers.get("cache-control") === "no-store",
    "嵌入票据兑换失败。",
  );
  const firstToken = result.data.token as string;
  const replay = await requestJson("/api/embed/exchange", {
    method: "POST",
    body: { ticket: firstTicket, origin: "http://localhost:4100" },
  });
  assert(
    replay.response.status === 401 &&
      !JSON.stringify(replay.data).includes(firstTicket),
    "一次性票据重复消费未失败关闭。",
  );

  result = await requestJson("/api/embed/tickets", {
    method: "POST",
    body: {
      externalUserId: "http-external",
      origin: "http://localhost:4100",
      displayName: "HTTP Embedded",
      displayEmail: "http-admin@example.com",
    },
    headers: { authorization, "x-real-ip": "192.0.2.23" },
  });
  const renewalTicket = result.data.ticket as string;
  result = await requestJson("/api/embed/exchange", {
    method: "POST",
    body: { ticket: renewalTicket, origin: "http://localhost:4100" },
    headers: { authorization: `Bearer ${firstToken}` },
  });
  assert(
    result.response.status === 200 && typeof result.data.token === "string",
    "嵌入会话续期失败。",
  );
  const renewedToken = result.data.token as string;
  const oldSession = await requestJson("/api/embed/revoke", {
    method: "POST",
    headers: { authorization: `Bearer ${firstToken}` },
  });
  assert(oldSession.response.status === 401, "续期后旧嵌入令牌仍然有效。");
  const embeddedAdminAttempt = await requestJson("/api/admin/users", {
    headers: { authorization: `Bearer ${renewedToken}` },
  });
  assert(
    embeddedAdminAttempt.response.status === 403 &&
      embeddedAdminAttempt.data.error?.code === "ADMIN_REQUIRED",
    "嵌入用户取得了管理员访问能力。",
  );

  result = await requestJson(`/api/admin/integrations/${client.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { status: "DISABLED" },
    headers: { origin },
  });
  assert(result.response.status === 200, "嵌入客户端停用失败。");
  const disabledSession = await requestJson("/api/embed/revoke", {
    method: "POST",
    headers: { authorization: `Bearer ${renewedToken}` },
  });
  assert(
    disabledSession.response.status === 401,
    "客户端停用后嵌入会话仍然有效。",
  );

  const directAuth = await requestJson("/api/auth/sign-in/email", {
    method: "POST",
    body: { email: "x@example.com", password: "password password" },
    headers: { origin },
  });
  assert(
    directAuth.response.status === 404,
    "Better Auth 内部登录端点仍可直接访问。",
  );
  page = await fetch(`${origin}/admin/users`, {
    headers: { cookie: adminCookie },
  });
  assert(
    page.status === 200 && page.url.endsWith("/admin/users"),
    "管理员页面访问失败。",
  );
  page = await fetch(`${origin}/admin/users`, {
    headers: { cookie: userCookie },
  });
  assert(
    page.status === 200 && page.url.endsWith("/settings"),
    "管理页面服务端权限控制失败。",
  );

  console.info(
    JSON.stringify({
      localLogin: "ok",
      forcedPasswordChange: "ok",
      csrf: "ok",
      rbac: "ok",
      adminPages: "ok",
      clientSecrets: "one-time",
      ticketReplay: "rejected",
      embeddedRenewal: "rotated",
      clientDisable: "revoked",
      directAuthEndpoints: "closed",
    }),
  );
} finally {
  await closeDatabase();
}
