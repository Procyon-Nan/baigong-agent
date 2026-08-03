import { requirePrincipal } from "@/src/server/authorization";
import { getConversation } from "@/src/server/conversations/service";
import { parseConversationId } from "@/src/server/http/p3-conversation-schemas";
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
    return jsonResponse({
      conversation: await getConversation(principal, conversationId),
    });
  });
}
