import type {
  PublicInputOption,
  PublicInputRequest,
  PublicInteractionOrigin,
  PublicPendingInput,
  PublicTodoItem,
} from "@/src/shared/conversation-ui-state";

export type {
  PublicInputOption,
  PublicInputRequest,
  PublicInteractionOrigin,
  PublicPendingInput,
  PublicTodoItem,
} from "@/src/shared/conversation-ui-state";

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
      "subagent.created",
      {
        readonly childConversationId: string;
        readonly name: string;
        readonly linkStatus: "PENDING" | "VERIFIED";
        readonly status: ConversationStatus;
      }
    >
  | PublicEvent<"input.requested", PublicPendingInput>
  | PublicEvent<"todo.updated", { readonly items: readonly PublicTodoItem[] }>
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
  if (
    !isRecord(value) ||
    !isRecord(value.conversation) ||
    !isRecord(value.turn)
  ) {
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
    case "subagent.created":
      return typeof data.childConversationId === "string" &&
        typeof data.name === "string" &&
        (data.linkStatus === "PENDING" || data.linkStatus === "VERIFIED") &&
        isConversationStatus(data.status)
        ? {
            ...base,
            type: value.type,
            data: {
              childConversationId: data.childConversationId,
              name: data.name,
              linkStatus: data.linkStatus,
              status: data.status,
            },
          }
        : null;
    case "input.requested": {
      const pendingInput = parsePendingInput(data);
      return pendingInput
        ? { ...base, type: value.type, data: pendingInput }
        : null;
    }
    case "todo.updated": {
      const items = parseTodoItems(data.items);
      return items ? { ...base, type: value.type, data: { items } } : null;
    }
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

export function parsePendingInput(
  value: unknown,
): PublicPendingInput | undefined {
  if (
    !isRecord(value) ||
    !isInteractionOrigin(value.origin) ||
    !Array.isArray(value.requests) ||
    value.requests.length === 0
  ) {
    return undefined;
  }
  const requests = value.requests.map(parseInputRequest);
  return requests.some((request) => request === null)
    ? undefined
    : {
        origin: value.origin,
        requests: requests as PublicInputRequest[],
      };
}

export function parseTodoItems(
  value: unknown,
): readonly PublicTodoItem[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(parseTodoItem);
  return items.some((item) => item === null)
    ? null
    : (items as PublicTodoItem[]);
}

function parseInputRequest(value: unknown): PublicInputRequest | null {
  if (
    !isRecord(value) ||
    typeof value.requestId !== "string" ||
    typeof value.prompt !== "string" ||
    !isInputDisplay(value.display) ||
    typeof value.allowFreeform !== "boolean" ||
    !Array.isArray(value.options)
  ) {
    return null;
  }
  const options = value.options.map(parseInputOption);
  return options.some((option) => option === null)
    ? null
    : {
        requestId: value.requestId,
        prompt: value.prompt,
        display: value.display,
        allowFreeform: value.allowFreeform,
        options: options as PublicInputOption[],
      };
}

function parseInputOption(value: unknown): PublicInputOption | null {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (typeof value.description === "string" || value.description === null) &&
    isInputOptionStyle(value.style)
    ? {
        id: value.id,
        label: value.label,
        description: value.description,
        style: value.style,
      }
    : null;
}

function parseTodoItem(value: unknown): PublicTodoItem | null {
  return isRecord(value) &&
    typeof value.content === "string" &&
    isTodoPriority(value.priority) &&
    isTodoStatus(value.status)
    ? {
        content: value.content,
        priority: value.priority,
        status: value.status,
      }
    : null;
}

function isInteractionOrigin(
  value: unknown,
): value is PublicInteractionOrigin {
  return value === "MAIN" || value === "SUBAGENT";
}

function isInputDisplay(
  value: unknown,
): value is PublicInputRequest["display"] {
  return (
    value === null ||
    value === "text" ||
    value === "confirmation" ||
    value === "select"
  );
}

function isInputOptionStyle(
  value: unknown,
): value is PublicInputOption["style"] {
  return (
    value === null ||
    value === "default" ||
    value === "primary" ||
    value === "danger"
  );
}

function isTodoPriority(
  value: unknown,
): value is PublicTodoItem["priority"] {
  return value === "high" || value === "medium" || value === "low";
}

function isTodoStatus(value: unknown): value is PublicTodoItem["status"] {
  return (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  );
}

export function splitNdjson(
  remainder: string,
  chunk: string,
): { readonly lines: readonly string[]; readonly remainder: string } {
  const parts = `${remainder}${chunk}`.split(/\r?\n/);
  return { lines: parts.slice(0, -1), remainder: parts.at(-1) ?? "" };
}

export function isConversationStatus(
  value: unknown,
): value is ConversationStatus {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
