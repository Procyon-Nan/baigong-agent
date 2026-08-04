import {
  isConversationStatus,
  isRecord,
  type ConversationStatus,
} from "./protocol";

export type ConversationSummary = {
  readonly id: string;
  readonly title: string;
  readonly status: ConversationStatus;
  readonly activeTurn: {
    readonly id: string;
    readonly status: ConversationTurnStatus;
  } | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ConversationHistoryMessage = {
  readonly id: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly role: "USER" | "ASSISTANT" | "DELEGATION";
  readonly status: "STREAMING" | "COMPLETED" | "STOPPED";
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ConversationSubagent = {
  readonly conversationId: string;
  readonly name: string;
  readonly linkStatus: "PENDING" | "VERIFIED";
  readonly status: ConversationStatus;
  readonly createdAt: string;
};

export type ConversationSnapshot = {
  readonly conversation: ConversationSummary;
  readonly context: {
    readonly kind: "MAIN" | "SUBAGENT";
    readonly parentConversationId: string | null;
    readonly subagentName: string | null;
    readonly linkStatus: "NOT_APPLICABLE" | "PENDING" | "VERIFIED" | "FAILED";
  };
  readonly messages: ConversationHistoryPage;
  readonly lastEveCursor: number | null;
  readonly subagents: readonly ConversationSubagent[];
};

export type ConversationHistoryPage = {
  readonly items: readonly ConversationHistoryMessage[];
  readonly nextCursor: string | null;
};

export type ConversationNode = {
  readonly id: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly summary: string;
  readonly createdAt: string;
};

export type ConversationNodePage = {
  readonly items: readonly ConversationNode[];
  readonly nextCursor: string | null;
};

export type ConversationListPage = {
  readonly items: readonly ConversationSummary[];
  readonly nextCursor: string | null;
};

type ConversationTurnStatus =
  | "SUBMITTING"
  | "RUNNING"
  | "CANCELLING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export function parseConversationListPage(
  value: unknown,
): ConversationListPage | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items = value.items.map(parseConversationSummary);
  if (items.some((item) => item === null)) return null;
  const nextCursor = nullableString(value.nextCursor);
  if (nextCursor === undefined) return null;
  return {
    items: items as ConversationSummary[],
    nextCursor,
  };
}

export function parseConversationSnapshot(
  value: unknown,
): ConversationSnapshot | null {
  if (!isRecord(value)) return null;
  const conversation = parseConversationSummary(value.conversation);
  const context = parseConversationContext(value.context);
  const messages = parseConversationHistoryPage(value.messages);
  const subagents = Array.isArray(value.subagents)
    ? value.subagents.map(parseConversationSubagent)
    : null;
  if (
    !conversation ||
    !context ||
    !messages ||
    !subagents ||
    subagents.some((subagent) => subagent === null) ||
    !isNullableSafeCursor(value.lastEveCursor)
  ) {
    return null;
  }
  return {
    conversation,
    context,
    messages,
    lastEveCursor: value.lastEveCursor as number | null,
    subagents: subagents as ConversationSubagent[],
  };
}

export function parseConversationHistoryPage(
  value: unknown,
): ConversationHistoryPage | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items = value.items.map(parseHistoryMessage);
  const nextCursor = nullableString(value.nextCursor);
  if (items.some((item) => item === null) || nextCursor === undefined) {
    return null;
  }
  return {
    items: items as ConversationHistoryMessage[],
    nextCursor,
  };
}

export function parseConversationNodePage(
  value: unknown,
): ConversationNodePage | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items = value.items.map(parseConversationNode);
  const nextCursor = nullableString(value.nextCursor);
  if (items.some((item) => item === null) || nextCursor === undefined) {
    return null;
  }
  return { items: items as ConversationNode[], nextCursor };
}

function parseConversationSummary(value: unknown): ConversationSummary | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !isConversationStatus(value.status) ||
    !isNullableTimestamp(value.archivedAt) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt)
  ) {
    return null;
  }
  const activeTurn = parseActiveTurn(value.activeTurn);
  if (activeTurn === undefined) return null;
  return {
    id: value.id,
    title: value.title,
    status: value.status,
    activeTurn,
    archivedAt: value.archivedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseActiveTurn(
  value: unknown,
): ConversationSummary["activeTurn"] | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isConversationTurnStatus(value.status)
  ) {
    return undefined;
  }
  return { id: value.id, status: value.status };
}

function parseConversationContext(
  value: unknown,
): ConversationSnapshot["context"] | null {
  if (
    !isRecord(value) ||
    (value.kind !== "MAIN" && value.kind !== "SUBAGENT") ||
    !(typeof value.parentConversationId === "string" ||
      value.parentConversationId === null) ||
    !(typeof value.subagentName === "string" || value.subagentName === null) ||
    !isLinkStatus(value.linkStatus)
  ) {
    return null;
  }
  return {
    kind: value.kind,
    parentConversationId: value.parentConversationId,
    subagentName: value.subagentName,
    linkStatus: value.linkStatus,
  };
}

function parseHistoryMessage(
  value: unknown,
): ConversationHistoryMessage | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.turnId !== "string" ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    !isHistoryRole(value.role) ||
    !isHistoryStatus(value.status) ||
    typeof value.body !== "string" ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt)
  ) {
    return null;
  }
  return {
    id: value.id,
    turnId: value.turnId,
    sequence: value.sequence as number,
    role: value.role,
    status: value.status,
    body: value.body,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseConversationSubagent(
  value: unknown,
): ConversationSubagent | null {
  return isRecord(value) &&
    typeof value.conversationId === "string" &&
    typeof value.name === "string" &&
    (value.linkStatus === "PENDING" || value.linkStatus === "VERIFIED") &&
    isConversationStatus(value.status) &&
    isTimestamp(value.createdAt)
    ? {
        conversationId: value.conversationId,
        name: value.name,
        linkStatus: value.linkStatus,
        status: value.status,
        createdAt: value.createdAt,
      }
    : null;
}

function parseConversationNode(value: unknown): ConversationNode | null {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.turnId === "string" &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) > 0 &&
    typeof value.summary === "string" &&
    isTimestamp(value.createdAt)
    ? {
        id: value.id,
        turnId: value.turnId,
        sequence: value.sequence as number,
        summary: value.summary,
        createdAt: value.createdAt,
      }
    : null;
}

function isConversationTurnStatus(value: unknown): value is ConversationTurnStatus {
  return (
    value === "SUBMITTING" ||
    value === "RUNNING" ||
    value === "CANCELLING" ||
    value === "COMPLETED" ||
    value === "FAILED" ||
    value === "CANCELLED"
  );
}

function isHistoryRole(
  value: unknown,
): value is ConversationHistoryMessage["role"] {
  return value === "USER" || value === "ASSISTANT" || value === "DELEGATION";
}

function isHistoryStatus(
  value: unknown,
): value is ConversationHistoryMessage["status"] {
  return value === "STREAMING" || value === "COMPLETED" || value === "STOPPED";
}

function isLinkStatus(
  value: unknown,
): value is ConversationSnapshot["context"]["linkStatus"] {
  return (
    value === "NOT_APPLICABLE" ||
    value === "PENDING" ||
    value === "VERIFIED" ||
    value === "FAILED"
  );
}

function nullableString(value: unknown): string | null | undefined {
  return typeof value === "string" ? value : value === null ? null : undefined;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isNullableSafeCursor(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isSafeInteger(value) && (value as number) >= 0)
  );
}
