import { isInputRequest } from "eve/client";
import type {
  EveEventProjectionContext,
  PublicAuthorizationChallenge,
  PublicConversationEvent,
  PublicInputRequest,
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
  if (!context.interactionOrigin || !isRecord(event.data)) return null;
  const rawRequests = event.data.requests;
  if (!Array.isArray(rawRequests) || rawRequests.length === 0) return null;

  const requests: PublicInputRequest[] = [];
  for (const request of rawRequests) {
    if (!isInputRequest(request)) return null;
    requests.push({
      requestId: request.requestId,
      prompt: request.prompt,
      display: request.display ?? null,
      allowFreeform: request.allowFreeform ?? false,
      options:
        request.options?.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description ?? null,
          style: option.style ?? null,
        })) ?? [],
    });
  }

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
