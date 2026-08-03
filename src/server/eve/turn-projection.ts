import type {
  AssistantTextUpdate,
  EveEventProjectionContext,
  PublicConversationEvent,
  PublicConversationStatus,
} from "./projection-types";
import {
  createConversationStatusEvent,
  createPublicConversationError,
} from "./projection-types";

export function projectConversationStatus(
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

export function projectTurnBoundary(
  context: EveEventProjectionContext,
  at: string,
  type: "turn.started" | "turn.completed" | "turn.cancelled",
): PublicConversationEvent | null {
  if (!context.turnId) return null;
  return {
    type,
    conversationId: context.conversationId,
    cursor: context.cursor,
    at,
    data: { turnId: context.turnId },
  };
}

export function projectMessageDelta(
  event: Record<string, unknown>,
  context: EveEventProjectionContext,
  at: string,
): PublicConversationEvent | null {
  if (!context.turnId || !context.assistantBlockId) return null;
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

export function projectMessageCompleted(
  event: Record<string, unknown>,
  context: EveEventProjectionContext,
  at: string,
): PublicConversationEvent | null {
  if (!context.turnId || !context.assistantBlockId) return null;
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

export function projectTurnFailure(
  context: EveEventProjectionContext,
  at: string,
): PublicConversationEvent | null {
  if (!context.turnId) return null;
  return {
    type: "turn.failed",
    conversationId: context.conversationId,
    cursor: context.cursor,
    at,
    data: {
      turnId: context.turnId,
      error: createPublicConversationError(
        context.failureCode ?? "REQUEST_FAILED",
      ),
      discardBlockId: context.assistantBlockId ?? null,
    },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
