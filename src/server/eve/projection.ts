import {
  projectAuthorizationRequired,
  projectInputRequested,
  projectSubagentCreated,
} from "./interaction-projection";
import type {
  EveEventProjectionContext,
  PublicConversationEvent,
} from "./projection-types";
import {
  projectConversationStatus,
  projectMessageCompleted,
  projectMessageDelta,
  projectTurnBoundary,
  projectTurnFailure,
} from "./turn-projection";
import { projectTodoUpdated } from "./todo-projection";

export {
  createAuthenticationExpiredEvent,
  createConversationStatusEvent,
  createHeartbeatEvent,
  PUBLIC_CONVERSATION_ERROR_CODES,
  PUBLIC_CONVERSATION_EVENT_TYPES,
  PUBLIC_CONVERSATION_STATUSES,
} from "./projection-types";
export type {
  AssistantTextUpdate,
  EveEventProjectionContext,
  PublicAuthorizationChallenge,
  PublicConversationError,
  PublicConversationErrorCode,
  PublicConversationEvent,
  PublicConversationStatus,
  PublicInputOption,
  PublicInputRequest,
  PublicInteractionOrigin,
  PublicTodoItem,
} from "./projection-types";
export { reconcileAssistantText } from "./turn-projection";

/**
 * Projects one raw eve event by explicitly constructing the public shape.
 * Events and fields outside this allowlist are discarded instead of forwarded.
 */
export function projectEveEvent(
  event: unknown,
  context: EveEventProjectionContext,
): PublicConversationEvent | null {
  if (!isRecord(event) || typeof event.type !== "string") return null;
  const at = eventTimestamp(event);
  if (!at) return null;

  switch (event.type) {
    case "session.started":
      return projectConversationStatus(context, at, "RUNNING");
    case "session.waiting":
      return projectConversationStatus(context, at, "WAITING");
    case "session.failed":
      return projectConversationStatus(context, at, "TERMINAL_FAILED");
    case "session.completed":
      return projectConversationStatus(context, at, "TERMINAL_COMPLETED");
    case "turn.started":
      return projectTurnBoundary(context, at, "turn.started");
    case "message.appended":
      return projectMessageDelta(event, context, at);
    case "message.completed":
      return projectMessageCompleted(event, context, at);
    case "turn.completed":
      return projectTurnBoundary(context, at, "turn.completed");
    case "turn.cancelled":
      return projectTurnBoundary(context, at, "turn.cancelled");
    case "turn.failed":
      return projectTurnFailure(context, at);
    case "subagent.called":
      return projectSubagentCreated(context, at);
    case "input.requested":
      return projectInputRequested(event, context, at);
    case "action.result":
      return projectTodoUpdated(event, context, at);
    case "authorization.required":
      return projectAuthorizationRequired(event, context, at);
    default:
      return null;
  }
}

function eventTimestamp(event: Record<string, unknown>): string | null {
  if (!isRecord(event.meta) || typeof event.meta.at !== "string") return null;
  return Number.isFinite(Date.parse(event.meta.at)) ? event.meta.at : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
