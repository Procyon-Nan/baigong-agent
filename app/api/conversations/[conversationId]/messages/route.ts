import { after } from "next/server";
import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requirePrincipal } from "@/src/server/authorization";
import {
  continueConversation,
  listConversationMessages,
} from "@/src/server/conversations/service";
import {
  P3_CONVERSATION_REQUEST_MAX_BYTES,
  parseConversationId,
  submitConversationMessageSchema,
  parseConversationHistoryQuery,
} from "@/src/server/http/p3-conversation-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requirePrincipal(request.headers);
    const { conversationId: rawConversationId } = await context.params;
    const conversationId = parseConversationId(rawConversationId);
    const query = parseConversationHistoryQuery(
      new URL(request.url).searchParams,
    );
    return jsonResponse(
      await listConversationMessages(principal, conversationId, query),
    );
  });
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requirePrincipal(request.headers);
    const { conversationId: rawConversationId } = await context.params;
    const conversationId = parseConversationId(rawConversationId);
    const body = await parseJsonBody(request, submitConversationMessageSchema, {
      maxBytes: P3_CONVERSATION_REQUEST_MAX_BYTES,
    });
    const submission = await continueConversation(
      principal,
      conversationId,
      body,
    );
    if (submission.monitor) after(submission.monitor);
    return jsonResponse({
      conversation: submission.conversation,
      turn: submission.turn,
      duplicate: submission.duplicate,
    });
  });
}
