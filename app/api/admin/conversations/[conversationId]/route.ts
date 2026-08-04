import { requireAdmin } from "@/src/server/authorization";
import { getAdminConversationAuditDetails } from "@/src/server/conversations/service";
import { parseConversationId } from "@/src/server/http/p3-conversation-schemas";
import { parseAdminConversationDetailQuery } from "@/src/server/http/p4-admin-conversation-schemas";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requireAdmin(request.headers);
    const { conversationId: rawConversationId } = await context.params;
    const conversationId = parseConversationId(rawConversationId);
    const query = parseAdminConversationDetailQuery(
      new URL(request.url).searchParams,
    );
    return jsonResponse(
      await getAdminConversationAuditDetails(principal, conversationId, query),
    );
  });
}
