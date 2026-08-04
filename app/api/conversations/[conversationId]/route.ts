import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requirePrincipal } from "@/src/server/authorization";
import {
  getConversationSnapshot,
  renameConversation,
} from "@/src/server/conversations/service";
import {
  P3_CONVERSATION_REQUEST_MAX_BYTES,
  conversationTitleSchema,
  parseConversationHistoryQuery,
  parseConversationId,
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
      await getConversationSnapshot(principal, conversationId, query),
    );
  });
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requirePrincipal(request.headers);
    const { conversationId: rawConversationId } = await context.params;
    const conversationId = parseConversationId(rawConversationId);
    const body = await parseJsonBody(request, conversationTitleSchema, {
      maxBytes: P3_CONVERSATION_REQUEST_MAX_BYTES,
    });
    return jsonResponse({
      conversation: await renameConversation(
        principal,
        conversationId,
        body.title,
      ),
    });
  });
}
