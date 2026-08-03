import { splitNdjson } from "./protocol";

export type AdminRawEvent = {
  readonly index: number;
  readonly type: string;
  readonly at: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
};

export class AdminEventStreamAuthenticationError extends Error {
  constructor() {
    super("管理员登录状态已失效。");
    this.name = "AdminEventStreamAuthenticationError";
  }
}

export async function readAdminEventStream(input: {
  readonly conversationId: string;
  readonly startIndex: number;
  readonly signal: AbortSignal;
  readonly onEvents: (events: readonly AdminRawEvent[]) => void;
}): Promise<number> {
  const token = await requestStreamToken(input.conversationId, input.signal);
  const response = await fetch(
    `/eve/v1/admin/stream?startIndex=${input.startIndex}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: input.signal,
    },
  );
  if (response.status === 401 || response.status === 403) {
    throw new Error("管理员事件流令牌已失效。");
  }
  if (!response.ok || !response.body) {
    throw new Error("管理员事件流暂时不可用。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  let nextIndex = input.startIndex;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const split = splitNdjson(
      remainder,
      decoder.decode(value, { stream: true }),
    );
    remainder = split.remainder;
    const events: AdminRawEvent[] = [];
    for (const line of split.lines) {
      const event = parseAdminRawEvent(line, nextIndex);
      nextIndex += 1;
      if (event) events.push(event);
    }
    if (events.length > 0) input.onEvents(events);
  }

  const finalLine = `${remainder}${decoder.decode()}`.trim();
  if (finalLine) {
    const event = parseAdminRawEvent(finalLine, nextIndex);
    nextIndex += 1;
    if (event) input.onEvents([event]);
  }
  return nextIndex;
}

export function parseAdminRawEvent(
  line: string,
  index: number,
): AdminRawEvent | null {
  if (!Number.isSafeInteger(index) || index < 0 || !line.trim()) return null;
  try {
    const raw: unknown = JSON.parse(line);
    if (!isRecord(raw) || typeof raw.type !== "string") return null;
    return {
      index,
      type: raw.type,
      at: eventTimestamp(raw),
      raw,
    };
  } catch {
    return null;
  }
}

async function requestStreamToken(
  conversationId: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(
    `/api/admin/conversations/${conversationId}/stream-token`,
    { method: "POST", signal },
  );
  if (response.status === 401 || response.status === 403) {
    throw new AdminEventStreamAuthenticationError();
  }
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !isRecord(payload) ||
    typeof payload.token !== "string" ||
    payload.token.length === 0
  ) {
    throw new Error("无法建立管理员事件流。");
  }
  return payload.token;
}

function eventTimestamp(event: Readonly<Record<string, unknown>>): string | null {
  if (!isRecord(event.meta) || typeof event.meta.at !== "string") return null;
  return Number.isFinite(Date.parse(event.meta.at)) ? event.meta.at : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
