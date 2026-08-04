import { FAKE_CHAT_MODELS } from "./fake-chat-completions";
import type { P4TestContext } from "@/tests/support/p4-test-database";

export const P4_FAKE_API_KEY = "p4-local-fake-provider-key";
const EMBEDDED_ORIGIN = "http://localhost:4100";

export type Authentication = {
  readonly cookie?: string;
  readonly authorization?: string;
};

export type ManagedUser = {
  readonly id: string;
  readonly cookie: string;
};

export type EmbeddedSession = {
  readonly token: string;
};

export type ApiData = {
  readonly error?: { readonly code?: string; readonly message?: string };
  readonly temporaryPassword?: string;
  readonly user?: { readonly id: string };
  readonly clientSecret?: string;
  readonly client?: { readonly id: string; readonly clientId: string };
  readonly ticket?: string;
  readonly token?: string;
  readonly conversation?: {
    readonly id: string;
    readonly title?: string;
    readonly status?: string;
    readonly archivedAt?: string | null;
  };
  readonly context?: { readonly kind?: string };
  readonly lastEveCursor?: number | null;
  readonly owner?: { readonly userId?: string; readonly source?: string };
  readonly messages?: {
    readonly items: readonly ApiItem[];
    readonly nextCursor?: string | null;
  };
  readonly actions?: { readonly items: readonly ApiItem[] };
  readonly items?: readonly ApiItem[];
};

type ApiItem = {
  readonly id?: string;
  readonly role?: string;
};

export function modelConfiguration(baseUrl: string) {
  return {
    providerDisplayName: "P4 Local Fake Provider",
    baseUrl,
    modelName: FAKE_CHAT_MODELS.streaming,
    contextWindowTokens: 8_192,
    apiKey: P4_FAKE_API_KEY,
  };
}

export async function createManagedUser(
  origin: string,
  adminCookie: string,
  context: P4TestContext,
): Promise<ManagedUser> {
  const username = `p4-user-${context.suffix}`;
  const result = await requestJson(origin, "/api/admin/users", {
    method: "POST",
    cookie: adminCookie,
    headers: { origin },
    body: {
      username,
      email: `${username}@example.com`,
      displayName: "P4 HTTP User",
      role: "USER",
    },
  });
  const temporaryPassword = result.data.temporaryPassword;
  const userId = result.data.user?.id;
  assertHttp(
    result.response.status === 201 && temporaryPassword && userId,
    "P4 普通用户创建失败。",
  );
  const cookie = await loginLocalUser(origin, context, {
    identifier: username,
    password: temporaryPassword,
    source: "192.0.2.82",
  });
  const newPassword = `P4 HTTP ${crypto.randomUUID()} password`;
  const changed = await requestJson(origin, "/api/auth/change-password", {
    method: "POST",
    cookie,
    headers: { origin },
    body: { currentPassword: temporaryPassword, newPassword },
  });
  assertHttp(
    changed.response.status === 200,
    "P4 普通用户首次修改密码失败。",
  );
  return { id: userId, cookie };
}

export async function loginLocalUser(
  origin: string,
  context: P4TestContext,
  input: {
    readonly identifier: string;
    readonly password: string;
    readonly source: string;
  },
): Promise<string> {
  context.loginSources.add(input.source);
  context.loginIdentifiers.add(input.identifier);
  const result = await requestJson(origin, "/api/auth/local-login", {
    method: "POST",
    headers: { origin, "x-real-ip": input.source },
    body: { identifier: input.identifier, password: input.password },
  });
  const cookie = result.response.headers.get("set-cookie");
  assertHttp(
    result.response.status === 200 && cookie,
    "P4 本地用户登录失败。",
  );
  return cookie;
}

export async function createEmbeddedSession(
  origin: string,
  adminCookie: string,
  context: P4TestContext,
  label: string,
  source: string,
): Promise<EmbeddedSession> {
  let result = await requestJson(origin, "/api/admin/integrations", {
    method: "POST",
    cookie: adminCookie,
    headers: { origin },
    body: {
      name: `P4 HTTP Host ${label} ${context.suffix}`,
      allowedOrigins: [EMBEDDED_ORIGIN],
    },
  });
  const client = result.data.client;
  const clientSecret = result.data.clientSecret;
  assertHttp(
    result.response.status === 201 && client && clientSecret,
    "P4 嵌入客户端创建失败。",
  );

  context.loginSources.add(`embedded-client:${source}`);
  const basic = Buffer.from(`${client.clientId}:${clientSecret}`).toString(
    "base64",
  );
  result = await requestJson(origin, "/api/embed/tickets", {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "x-real-ip": source },
    body: {
      externalUserId: `p4-${label}-${context.suffix}`,
      origin: EMBEDDED_ORIGIN,
      displayName: `P4 Embedded ${label}`,
    },
  });
  assertHttp(
    result.response.status === 201 && result.data.ticket,
    "嵌入票据签发失败。",
  );
  result = await requestJson(origin, "/api/embed/exchange", {
    method: "POST",
    body: { ticket: result.data.ticket, origin: EMBEDDED_ORIGIN },
  });
  assertHttp(
    result.response.status === 200 && result.data.token,
    "嵌入票据兑换失败。",
  );
  return { token: result.data.token };
}

export async function createConversation(
  origin: string,
  authentication: Authentication,
  message: string,
): Promise<{ readonly id: string }> {
  const result = await requestJson(origin, "/api/conversations", {
    method: "POST",
    cookie: authentication.cookie,
    authorization: authentication.authorization,
    headers: { origin },
    body: { message, requestId: crypto.randomUUID() },
  });
  const conversationId = result.data.conversation?.id;
  assertHttp(
    result.response.status === 201 && conversationId,
    "P4 会话创建失败。",
  );
  return { id: conversationId };
}

export async function waitForConversation(
  origin: string,
  authentication: Authentication,
  conversationId: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await requestJson(
      origin,
      `/api/conversations/${conversationId}`,
      {
        cookie: authentication.cookie,
        authorization: authentication.authorization,
      },
    );
    if (result.data.conversation?.status === "WAITING") return;
    if (result.data.conversation?.status?.startsWith("TERMINAL_")) {
      throw new Error(`P4 会话意外终止：${result.data.conversation.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("等待 P4 假模型回复完成超时。");
}

export async function requestJson(
  origin: string,
  path: string,
  options: {
    readonly method?: string;
    readonly cookie?: string;
    readonly authorization?: string;
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
      ...(options.authorization
        ? { authorization: `Bearer ${options.authorization}` }
        : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const text = await response.text();
  try {
    return {
      response,
      data: text ? (JSON.parse(text) as ApiData) : {},
    };
  } catch {
    throw new Error(
      `P4 接口 ${path} 返回非 JSON 响应（状态 ${response.status}）。`,
    );
  }
}

export function assertHttp(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}
