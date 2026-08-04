import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { cancelConversationTurn } from "@/src/server/conversations/service";
import {
  P3_CONVERSATION_REQUEST_MAX_BYTES,
  cancelConversationTurnSchema,
  parseConversationId,
} from "@/src/server/http/p3-conversation-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const { conversationId: rawConversationId } = await context.params;
    const conversationId = parseConversationId(rawConversationId);
    const body = await parseJsonBody(request, cancelConversationTurnSchema, {
      maxBytes: P3_CONVERSATION_REQUEST_MAX_BYTES,
    });
    return jsonResponse(
      await cancelConversationTurn(principal, conversationId, body.turnId),
    );
  });
}
