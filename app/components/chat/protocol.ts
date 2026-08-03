export type ConversationStatus =
  | "STARTING"
  | "RUNNING"
  | "CANCELLING"
  | "WAITING"
  | "TERMINAL_FAILED"
  | "TERMINAL_COMPLETED";

export type PublicConversationEvent =
  | PublicEvent<"conversation.status", { readonly status: ConversationStatus }>
  | PublicEvent<"turn.started", { readonly turnId: string }>
  | PublicEvent<
      "assistant.delta",
      {
        readonly turnId: string;
        readonly blockId: string;
        readonly delta: string;
        readonly text: string;
      }
    >
  | PublicEvent<
      "assistant.completed",
      { readonly turnId: string; readonly blockId: string; readonly text: string }
    >
  | PublicEvent<"turn.completed", { readonly turnId: string }>
  | PublicEvent<"turn.cancelled", { readonly turnId: string }>
  | PublicEvent<
      "turn.failed",
      {
        readonly turnId: string;
        readonly error: PublicConversationError;
        readonly discardBlockId: string | null;
      }
    >
  | PublicEvent<
      "authentication.expired",
      { readonly error: PublicConversationError }
    >
  | PublicEvent<"heartbeat", Record<string, never>>;

type PublicEvent<TType extends string, TData> = {
  readonly type: TType;
  readonly conversationId: string;
  readonly cursor: number;
  readonly at: string;
  readonly data: TData;
};

export type PublicConversationError = {
  readonly code: PublicConversationErrorCode;
  readonly message: string;
};

type PublicConversationErrorCode =
  | "MODEL_UNAVAILABLE"
  | "REQUEST_FAILED"
  | "CONVERSATION_BUSY"
  | "CONVERSATION_UNAVAILABLE"
  | "AUTHENTICATION_EXPIRED";

export type ConversationMutationResult = {
  readonly conversationId: string;
  readonly turnId: string;
  readonly status: ConversationStatus;
};

export function parseConversationMutationResult(
  value: unknown,
): ConversationMutationResult | null {
  if (!isRecord(value) || !isRecord(value.conversation) || !isRecord(value.turn)) {
    return null;
  }
  const conversation = value.conversation;
  const turn = value.turn;
  if (
    typeof conversation.id !== "string" ||
    typeof turn.id !== "string" ||
    !isConversationStatus(conversation.status)
  ) {
    return null;
  }
  return {
    conversationId: conversation.id,
    turnId: turn.id,
    status: conversation.status,
  };
}

export function parsePublicConversationEvent(
  value: unknown,
): PublicConversationEvent | null {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    typeof value.conversationId !== "string" ||
    !Number.isSafeInteger(value.cursor) ||
    (value.cursor as number) < -1 ||
    typeof value.at !== "string" ||
    !Number.isFinite(Date.parse(value.at)) ||
    !isRecord(value.data)
  ) {
    return null;
  }
  const base = {
    conversationId: value.conversationId,
    cursor: value.cursor as number,
    at: value.at,
  };
  const data = value.data;

  switch (value.type) {
    case "conversation.status":
      return isConversationStatus(data.status)
        ? { ...base, type: value.type, data: { status: data.status } }
        : null;
    case "turn.started":
    case "turn.completed":
    case "turn.cancelled":
      return typeof data.turnId === "string"
        ? { ...base, type: value.type, data: { turnId: data.turnId } }
        : null;
    case "assistant.delta":
      return typeof data.turnId === "string" &&
        typeof data.blockId === "string" &&
        typeof data.delta === "string" &&
        typeof data.text === "string"
        ? {
            ...base,
            type: value.type,
            data: {
              turnId: data.turnId,
              blockId: data.blockId,
              delta: data.delta,
              text: data.text,
            },
          }
        : null;
    case "assistant.completed":
      return typeof data.turnId === "string" &&
        typeof data.blockId === "string" &&
        typeof data.text === "string"
        ? {
            ...base,
            type: value.type,
            data: {
              turnId: data.turnId,
              blockId: data.blockId,
              text: data.text,
            },
          }
        : null;
    case "turn.failed":
      return typeof data.turnId === "string" &&
        isPublicError(data.error) &&
        (typeof data.discardBlockId === "string" ||
          data.discardBlockId === null)
        ? {
            ...base,
            type: value.type,
            data: {
              turnId: data.turnId,
              error: data.error,
              discardBlockId: data.discardBlockId,
            },
          }
        : null;
    case "authentication.expired":
      return isPublicError(data.error)
        ? { ...base, type: value.type, data: { error: data.error } }
        : null;
    case "heartbeat":
      return { ...base, type: value.type, data: {} };
    default:
      return null;
  }
}

export function splitNdjson(
  remainder: string,
  chunk: string,
): { readonly lines: readonly string[]; readonly remainder: string } {
  const parts = `${remainder}${chunk}`.split(/\r?\n/);
  return { lines: parts.slice(0, -1), remainder: parts.at(-1) ?? "" };
}

function isConversationStatus(value: unknown): value is ConversationStatus {
  return (
    value === "STARTING" ||
    value === "RUNNING" ||
    value === "CANCELLING" ||
    value === "WAITING" ||
    value === "TERMINAL_FAILED" ||
    value === "TERMINAL_COMPLETED"
  );
}

function isPublicError(value: unknown): value is PublicConversationError {
  return (
    isRecord(value) &&
    isPublicErrorCode(value.code) &&
    typeof value.message === "string"
  );
}

function isPublicErrorCode(
  value: unknown,
): value is PublicConversationErrorCode {
  return (
    value === "MODEL_UNAVAILABLE" ||
    value === "REQUEST_FAILED" ||
    value === "CONVERSATION_BUSY" ||
    value === "CONVERSATION_UNAVAILABLE" ||
    value === "AUTHENTICATION_EXPIRED"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
