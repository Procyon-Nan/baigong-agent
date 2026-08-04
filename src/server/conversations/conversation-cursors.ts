import "server-only";

import { invalidConversationCursor } from "./errors";

export type ConversationListCursor = {
  readonly updatedAt: string;
  readonly id: string;
};

export type ConversationHistoryCursor = {
  readonly sequence: number;
  readonly id: string;
};

export type ConversationNodeCursor = {
  readonly sequence: number;
  readonly id: string;
};

export function encodeConversationListCursor(
  cursor: ConversationListCursor,
): string {
  return encodeCursor({ kind: "conversation-list", ...cursor });
}

export function decodeConversationListCursor(
  value: string,
): ConversationListCursor {
  const decoded = decodeCursor(value, "conversation-list");
  if (
    typeof decoded.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(decoded.updatedAt)) ||
    typeof decoded.id !== "string" ||
    !isUuid(decoded.id)
  ) {
    throw invalidConversationCursor();
  }
  return { updatedAt: decoded.updatedAt, id: decoded.id };
}

export function encodeConversationHistoryCursor(
  cursor: ConversationHistoryCursor,
): string {
  return encodeCursor({ kind: "conversation-history", ...cursor });
}

export function decodeConversationHistoryCursor(
  value: string,
): ConversationHistoryCursor {
  return decodeSequenceCursor(value, "conversation-history");
}

export function encodeConversationNodeCursor(
  cursor: ConversationNodeCursor,
): string {
  return encodeCursor({ kind: "conversation-nodes", ...cursor });
}

export function decodeConversationNodeCursor(
  value: string,
): ConversationNodeCursor {
  return decodeSequenceCursor(value, "conversation-nodes");
}

export function decodeConversationCursor(
  value: string | undefined,
): ConversationListCursor | undefined {
  return value === undefined ? undefined : decodeConversationListCursor(value);
}

export function decodeHistoryCursor(
  value: string | undefined,
): ConversationHistoryCursor | undefined {
  return value === undefined
    ? undefined
    : decodeConversationHistoryCursor(value);
}

export function decodeNodeCursor(
  value: string | undefined,
): ConversationNodeCursor | undefined {
  return value === undefined
    ? undefined
    : decodeConversationNodeCursor(value);
}

function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string, kind: string): Record<string, unknown> {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded) ||
      (decoded as Record<string, unknown>).kind !== kind
    ) {
      throw new Error("invalid cursor");
    }
    return decoded as Record<string, unknown>;
  } catch (error) {
    throw invalidConversationCursor(error);
  }
}

function decodeSequenceCursor(
  value: string,
  kind: string,
): ConversationHistoryCursor {
  const decoded = decodeCursor(value, kind);
  const sequence = decoded.sequence;
  const id = decoded.id;
  if (
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    typeof id !== "string" ||
    !isUuid(id)
  ) {
    throw invalidConversationCursor();
  }
  return { sequence, id };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
