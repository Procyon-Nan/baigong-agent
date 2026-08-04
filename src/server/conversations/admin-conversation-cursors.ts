import "server-only";

import { invalidConversationCursor } from "./errors";

export type AdminConversationListCursor = {
  readonly updatedAt: string;
  readonly id: string;
  readonly filterKey: string;
};

export type AdminConversationActionCursor = {
  readonly requestEveCursor: number;
  readonly id: string;
};

export function encodeAdminConversationListCursor(
  cursor: AdminConversationListCursor,
): string {
  return encodeCursor({ kind: "admin-conversation-list", ...cursor });
}

export function decodeAdminConversationListCursor(
  value: string | undefined,
  expectedFilterKey: string,
): AdminConversationListCursor | undefined {
  if (value === undefined) return undefined;
  const decoded = decodeCursor(value, "admin-conversation-list");
  if (
    typeof decoded.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(decoded.updatedAt)) ||
    typeof decoded.id !== "string" ||
    !isUuid(decoded.id) ||
    decoded.filterKey !== expectedFilterKey
  ) {
    throw invalidConversationCursor();
  }
  return {
    updatedAt: decoded.updatedAt,
    id: decoded.id,
    filterKey: expectedFilterKey,
  };
}

export function encodeAdminConversationActionCursor(
  cursor: AdminConversationActionCursor,
): string {
  return encodeCursor({ kind: "admin-conversation-actions", ...cursor });
}

export function decodeAdminConversationActionCursor(
  value: string | undefined,
): AdminConversationActionCursor | undefined {
  if (value === undefined) return undefined;
  const decoded = decodeCursor(value, "admin-conversation-actions");
  if (
    typeof decoded.requestEveCursor !== "number" ||
    !Number.isSafeInteger(decoded.requestEveCursor) ||
    decoded.requestEveCursor < 0 ||
    typeof decoded.id !== "string" ||
    !isUuid(decoded.id)
  ) {
    throw invalidConversationCursor();
  }
  return {
    requestEveCursor: decoded.requestEveCursor,
    id: decoded.id,
  };
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
