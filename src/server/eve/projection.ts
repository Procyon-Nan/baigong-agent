export const PUBLIC_CONVERSATION_EVENT_TYPES = [
  "conversation.status",
  "turn.started",
  "assistant.delta",
  "assistant.completed",
  "turn.completed",
  "turn.cancelled",
  "turn.failed",
  "authentication.expired",
  "heartbeat",
] as const;

export const PUBLIC_CONVERSATION_STATUSES = [
  "STARTING",
  "RUNNING",
  "CANCELLING",
  "WAITING",
  "TERMINAL_FAILED",
  "TERMINAL_COMPLETED",
] as const;

export const PUBLIC_CONVERSATION_ERROR_CODES = [
  "MODEL_UNAVAILABLE",
  "REQUEST_FAILED",
  "CONVERSATION_BUSY",
  "CONVERSATION_UNAVAILABLE",
  "AUTHENTICATION_EXPIRED",
] as const;

export type PublicConversationStatus =
  (typeof PUBLIC_CONVERSATION_STATUSES)[number];
export type PublicConversationErrorCode =
  (typeof PUBLIC_CONVERSATION_ERROR_CODES)[number];

type PublicEventBase<TType extends string> = {
  readonly type: TType;
  readonly conversationId: string;
  readonly cursor: number;
  readonly at: string;
};

export type PublicConversationEvent =
  | (PublicEventBase<"conversation.status"> & {
      readonly data: { readonly status: PublicConversationStatus };
    })
  | (PublicEventBase<"turn.started"> & {
      readonly data: { readonly turnId: string };
    })
  | (PublicEventBase<"assistant.delta"> & {
      readonly data: {
        readonly turnId: string;
        readonly blockId: string;
        readonly delta: string;
        readonly text: string;
      };
    })
  | (PublicEventBase<"assistant.completed"> & {
      readonly data: {
        readonly turnId: string;
        readonly blockId: string;
        readonly text: string;
      };
    })
  | (PublicEventBase<"turn.completed"> & {
      readonly data: { readonly turnId: string };
    })
  | (PublicEventBase<"turn.cancelled"> & {
      readonly data: { readonly turnId: string };
    })
  | (PublicEventBase<"turn.failed"> & {
      readonly data: {
        readonly turnId: string;
        readonly error: PublicConversationError;
        readonly discardBlockId: string | null;
      };
    })
  | (PublicEventBase<"authentication.expired"> & {
      readonly data: {
        readonly error: PublicConversationError;
      };
    })
  | (PublicEventBase<"heartbeat"> & {
      readonly data: Record<string, never>;
    });

export type PublicConversationError = {
  readonly code: PublicConversationErrorCode;
  readonly message: string;
};

export type EveEventProjectionContext = {
  readonly conversationId: string;
  readonly cursor: number;
  readonly turnId?: string;
  readonly eveTurnId?: string;
  readonly assistantBlockId?: string;
  readonly failureCode?: PublicConversationErrorCode;
};

export type AssistantTextUpdate =
  | { readonly mode: "append"; readonly text: string }
  | { readonly mode: "replace"; readonly text: string };

/**
 * Projects one raw eve event by explicitly constructing the public shape.
 * Events and fields outside this allowlist are discarded instead of forwarded.
 */
export function projectEveEvent(
  event: unknown,
  context: EveEventProjectionContext,
): PublicConversationEvent | null {
  if (!isProjectionContext(context) || !isRecord(event)) return null;
  const at = eventTimestamp(event);
  if (!at || typeof event.type !== "string") return null;

  switch (event.type) {
    case "session.started":
      return conversationStatusEvent(context, at, "RUNNING");
    case "session.waiting":
      return conversationStatusEvent(context, at, "WAITING");
    case "session.failed":
      return conversationStatusEvent(context, at, "TERMINAL_FAILED");
    case "session.completed":
      return conversationStatusEvent(context, at, "TERMINAL_COMPLETED");
    case "turn.started":
      return projectTurnBoundary(event, context, at, "turn.started");
    case "message.appended":
      return projectMessageDelta(event, context, at);
    case "message.completed":
      return projectMessageCompleted(event, context, at);
    case "turn.completed":
      return projectTurnBoundary(event, context, at, "turn.completed");
    case "turn.cancelled":
      return projectTurnBoundary(event, context, at, "turn.cancelled");
    case "turn.failed":
      return projectTurnFailure(event, context, at);
    default:
      return null;
  }
}

export function createConversationStatusEvent(input: {
  readonly conversationId: string;
  readonly cursor: number;
  readonly at: string;
  readonly status: PublicConversationStatus;
}): PublicConversationEvent {
  return {
    type: "conversation.status",
    conversationId: input.conversationId,
    cursor: input.cursor,
    at: input.at,
    data: { status: input.status },
  };
}

export function createAuthenticationExpiredEvent(input: {
  readonly conversationId: string;
  readonly cursor: number;
  readonly at: string;
}): PublicConversationEvent {
  return {
    type: "authentication.expired",
    conversationId: input.conversationId,
    cursor: input.cursor,
    at: input.at,
    data: { error: publicError("AUTHENTICATION_EXPIRED") },
  };
}

export function createHeartbeatEvent(input: {
  readonly conversationId: string;
  readonly cursor: number;
  readonly at: string;
}): PublicConversationEvent {
  return {
    type: "heartbeat",
    conversationId: input.conversationId,
    cursor: input.cursor,
    at: input.at,
    data: {},
  };
}

export function reconcileAssistantText(
  previousText: string,
  event: Extract<PublicConversationEvent, { type: "assistant.delta" }>,
): AssistantTextUpdate {
  if (
    event.data.text.startsWith(previousText) &&
    event.data.text === `${previousText}${event.data.delta}`
  ) {
    return { mode: "append", text: event.data.delta };
  }
  return { mode: "replace", text: event.data.text };
}

function conversationStatusEvent(
  context: EveEventProjectionContext,
  at: string,
  status: PublicConversationStatus,
): PublicConversationEvent {
  return createConversationStatusEvent({
    conversationId: context.conversationId,
    cursor: context.cursor,
    at,
    status,
  });
}

function projectTurnBoundary(
  event: Record<string, unknown>,
  context: EveEventProjectionContext,
  at: string,
  type: "turn.started" | "turn.completed" | "turn.cancelled",
): PublicConversationEvent | null {
  if (!matchesTurn(event, context) || !context.turnId) return null;
  return {
    type,
    conversationId: context.conversationId,
    cursor: context.cursor,
    at,
    data: { turnId: context.turnId },
  };
}

function projectMessageDelta(
  event: Record<string, unknown>,
  context: EveEventProjectionContext,
  at: string,
): PublicConversationEvent | null {
  if (
    !matchesTurn(event, context) ||
    !context.turnId ||
    !context.assistantBlockId
  ) {
    return null;
  }
  const data = event.data;
  if (
    !isRecord(data) ||
    typeof data.messageDelta !== "string" ||
    typeof data.messageSoFar !== "string"
  ) {
    return null;
  }
  return {
    type: "assistant.delta",
    conversationId: context.conversationId,
    cursor: context.cursor,
    at,
    data: {
      turnId: context.turnId,
      blockId: context.assistantBlockId,
      delta: data.messageDelta,
      text: data.messageSoFar,
    },
  };
}

function projectMessageCompleted(
  event: Record<string, unknown>,
  context: EveEventProjectionContext,
  at: string,
): PublicConversationEvent | null {
  if (
    !matchesTurn(event, context) ||
    !context.turnId ||
    !context.assistantBlockId
  ) {
    return null;
  }
  const data = event.data;
  if (!isRecord(data) || typeof data.message !== "string") return null;
  return {
    type: "assistant.completed",
    conversationId: context.conversationId,
    cursor: context.cursor,
    at,
    data: {
      turnId: context.turnId,
      blockId: context.assistantBlockId,
      text: data.message,
    },
  };
}

function projectTurnFailure(
  event: Record<string, unknown>,
  context: EveEventProjectionContext,
  at: string,
): PublicConversationEvent | null {
  if (!matchesTurn(event, context) || !context.turnId) return null;
  return {
    type: "turn.failed",
    conversationId: context.conversationId,
    cursor: context.cursor,
    at,
    data: {
      turnId: context.turnId,
      error: publicError(context.failureCode ?? "REQUEST_FAILED"),
      discardBlockId: context.assistantBlockId ?? null,
    },
  };
}

function matchesTurn(
  event: Record<string, unknown>,
  context: EveEventProjectionContext,
): boolean {
  if (!context.eveTurnId) return false;
  const data = event.data;
  return isRecord(data) && data.turnId === context.eveTurnId;
}

function publicError(code: PublicConversationErrorCode): PublicConversationError {
  const messages: Record<PublicConversationErrorCode, string> = {
    MODEL_UNAVAILABLE: "模型服务暂时不可用，请稍后重试。",
    REQUEST_FAILED: "回复生成失败，请重试。",
    CONVERSATION_BUSY: "当前对话正在生成回复。",
    CONVERSATION_UNAVAILABLE: "当前对话不可用。",
    AUTHENTICATION_EXPIRED: "登录状态已失效，请重新登录。",
  };
  return { code, message: messages[code] };
}

function eventTimestamp(event: Record<string, unknown>): string | null {
  if (!isRecord(event.meta) || typeof event.meta.at !== "string") return null;
  const timestamp = Date.parse(event.meta.at);
  return Number.isFinite(timestamp) ? event.meta.at : null;
}

function isProjectionContext(
  context: EveEventProjectionContext,
): context is EveEventProjectionContext {
  return (
    typeof context.conversationId === "string" &&
    context.conversationId.length > 0 &&
    Number.isSafeInteger(context.cursor) &&
    context.cursor >= 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
