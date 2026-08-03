import {
  parsePublicConversationEvent,
  splitNdjson,
  type PublicConversationEvent,
} from "./protocol";

export async function readConversationEventStream(input: {
  readonly authorizationToken?: string;
  readonly conversationId: string;
  readonly cursor: number | null;
  readonly signal: AbortSignal;
  readonly onEvent: (event: PublicConversationEvent) => void;
  readonly onAuthenticationExpired: () => void;
}): Promise<boolean> {
  const query = input.cursor === null ? "" : `?after=${input.cursor}`;
  try {
    const response = await fetch(
      `/api/conversations/${input.conversationId}/events${query}`,
      {
        headers: authorizationHeaders(input.authorizationToken),
        signal: input.signal,
      },
    );
    if (response.status === 401 || response.status === 403) {
      input.onAuthenticationExpired();
      return false;
    }
    if (!response.ok || !response.body) return true;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let remainder = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const split = splitNdjson(
        remainder,
        decoder.decode(value, { stream: true }),
      );
      remainder = split.remainder;
      for (const line of split.lines) processEventLine(line, input.onEvent);
    }
    const finalLine = `${remainder}${decoder.decode()}`.trim();
    if (finalLine) processEventLine(finalLine, input.onEvent);
    return true;
  } catch {
    return !input.signal.aborted;
  }
}

export async function requestConversation(
  path: string,
  options: {
    readonly authorizationToken?: string;
    readonly method: string;
    readonly body: unknown;
  },
): Promise<unknown> {
  const headers = authorizationHeaders(options.authorizationToken);
  headers.set("content-type", "application/json");
  const response = await fetch(path, {
    method: options.method,
    headers,
    body: JSON.stringify(options.body),
  });
  let payload: unknown = null;
  let parsed = false;
  try {
    payload = await response.json();
    parsed = true;
  } catch {
    // Authentication failures must still terminate embedded sessions when the
    // upstream response does not contain JSON.
  }
  const authenticationExpired =
    response.status === 401 ||
    (Boolean(options.authorizationToken) && response.status === 403);
  if (authenticationExpired) {
    throw new ConversationRequestError(
      publicApiError(payload, "登录状态已失效，请重新登录。"),
      true,
    );
  }
  if (!parsed) throw new Error("服务器响应格式无效。");
  if (!response.ok) throw new ConversationRequestError(publicApiError(payload));
  return payload;
}

export function isConversationAuthenticationError(
  value: unknown,
): boolean {
  return (
    value instanceof ConversationRequestError && value.authenticationExpired
  );
}

export function chatClientErrorMessage(value: unknown): string {
  return value instanceof Error && value.message
    ? value.message
    : "操作失败。";
}

function processEventLine(
  line: string,
  onEvent: (event: PublicConversationEvent) => void,
) {
  if (!line.trim()) return;
  try {
    const event = parsePublicConversationEvent(JSON.parse(line));
    if (event) onEvent(event);
  } catch {
    // Invalid or future event shapes are ignored by the public allowlist.
  }
}

function authorizationHeaders(token?: string): Headers {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
}

class ConversationRequestError extends Error {
  constructor(
    message: string,
    readonly authenticationExpired = false,
  ) {
    super(message);
    this.name = "ConversationRequestError";
  }
}

function publicApiError(value: unknown, fallback = "操作失败。"): string {
  if (!value || typeof value !== "object") return fallback;
  const error = (value as { readonly error?: unknown }).error;
  if (!error || typeof error !== "object") return fallback;
  const message = (error as { readonly message?: unknown }).message;
  return typeof message === "string" && message ? message : fallback;
}
