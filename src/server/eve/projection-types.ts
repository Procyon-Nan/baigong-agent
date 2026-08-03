export const PUBLIC_CONVERSATION_EVENT_TYPES = [
  "conversation.status",
  "turn.started",
  "assistant.delta",
  "assistant.completed",
  "turn.completed",
  "turn.cancelled",
  "turn.failed",
  "subagent.created",
  "input.requested",
  "authorization.required",
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
  | (PublicEventBase<"subagent.created"> & {
      readonly data: {
        readonly childConversationId: string;
        readonly name: string;
        readonly linkStatus: "PENDING" | "VERIFIED";
        readonly status: PublicConversationStatus;
      };
    })
  | (PublicEventBase<"input.requested"> & {
      readonly data: {
        readonly origin: PublicInteractionOrigin;
        readonly requests: readonly PublicInputRequest[];
      };
    })
  | (PublicEventBase<"authorization.required"> & {
      readonly data: {
        readonly origin: PublicInteractionOrigin;
        readonly description: string;
        readonly authorization: PublicAuthorizationChallenge | null;
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

export type PublicInteractionOrigin = "MAIN" | "SUBAGENT";

export type PublicInputRequest = {
  readonly requestId: string;
  readonly prompt: string;
  readonly display: "text" | "confirmation" | "select" | null;
  readonly allowFreeform: boolean;
  readonly options: readonly PublicInputOption[];
};

export type PublicInputOption = {
  readonly id: string;
  readonly label: string;
  readonly description: string | null;
  readonly style: "default" | "primary" | "danger" | null;
};

export type PublicAuthorizationChallenge = {
  readonly displayName: string | null;
  readonly url: string | null;
  readonly userCode: string | null;
  readonly expiresAt: string | null;
  readonly instructions: string | null;
};

export type EveEventProjectionContext = {
  readonly conversationId: string;
  readonly cursor: number;
  readonly turnId?: string;
  readonly assistantBlockId?: string;
  readonly failureCode?: PublicConversationErrorCode;
  readonly subagent?: {
    readonly conversationId: string;
    readonly name: string;
    readonly linkStatus: "PENDING" | "VERIFIED";
    readonly status: PublicConversationStatus;
  };
  readonly interactionOrigin?: PublicInteractionOrigin;
};

export type AssistantTextUpdate =
  | { readonly mode: "append"; readonly text: string }
  | { readonly mode: "replace"; readonly text: string };

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
    data: { error: createPublicConversationError("AUTHENTICATION_EXPIRED") },
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

export function createPublicConversationError(
  code: PublicConversationErrorCode,
): PublicConversationError {
  const messages: Record<PublicConversationErrorCode, string> = {
    MODEL_UNAVAILABLE: "模型服务暂时不可用，请稍后重试。",
    REQUEST_FAILED: "回复生成失败，请重试。",
    CONVERSATION_BUSY: "当前对话正在生成回复。",
    CONVERSATION_UNAVAILABLE: "当前对话不可用。",
    AUTHENTICATION_EXPIRED: "登录状态已失效，请重新登录。",
  };
  return { code, message: messages[code] };
}
