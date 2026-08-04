import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { archiveAdminConversation } from "@/src/server/conversations/service";
import { parseConversationId } from "@/src/server/http/p3-conversation-schemas";
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
    const archived = await archiveAdminConversation(principal, conversationId);
    return jsonResponse(archived);
  });
}
