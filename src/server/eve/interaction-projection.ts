import { projectInputRequests } from "@/src/server/conversations/ui-state-projection";
import type {
  EveEventProjectionContext,
  PublicAuthorizationChallenge,
  PublicConversationEvent,
} from "./projection-types";

export function projectSubagentCreated(
  context: EveEventProjectionContext,
  at: string,
): PublicConversationEvent | null {
  if (!context.subagent) return null;
  return {
    type: "subagent.created",
    conversationId: context.conversationId,
    cursor: context.cursor,
    at,
    data: {
      childConversationId: context.subagent.conversationId,
      name: context.subagent.name,
      linkStatus: context.subagent.linkStatus,
      status: context.subagent.status,
    },
  };
}

export function projectInputRequested(
  event: Record<string, unknown>,
  context: EveEventProjectionContext,
  at: string,
): PublicConversationEvent | null {
  if (!context.interactionOrigin) return null;
  const requests = projectInputRequests(event);
  if (!requests) return null;

  return {
    type: "input.requested",
    conversationId: context.conversationId,
    cursor: context.cursor,
    at,
    data: { origin: context.interactionOrigin, requests },
  };
}

export function projectAuthorizationRequired(
  event: Record<string, unknown>,
  context: EveEventProjectionContext,
  at: string,
): PublicConversationEvent | null {
  if (
    !context.interactionOrigin ||
    !isRecord(event.data) ||
    typeof event.data.description !== "string"
  ) {
    return null;
  }
  return {
    type: "authorization.required",
    conversationId: context.conversationId,
    cursor: context.cursor,
    at,
    data: {
      origin: context.interactionOrigin,
      description: event.data.description,
      authorization: projectAuthorizationChallenge(event.data.authorization),
    },
  };
}

function projectAuthorizationChallenge(
  value: unknown,
): PublicAuthorizationChallenge | null {
  if (!isRecord(value)) return null;
  return {
    displayName: stringField(value.displayName),
    url: safeAuthorizationUrl(value.url),
    userCode: stringField(value.userCode),
    expiresAt: validTimestamp(value.expiresAt),
    instructions: stringField(value.instructions),
  };
}

function safeAuthorizationUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? value
      : null;
  } catch {
    return null;
  }
}

function validTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
