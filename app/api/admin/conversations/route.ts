import { requireAdmin } from "@/src/server/authorization";
import { listAdminConversations } from "@/src/server/conversations/service";
import { parseAdminConversationListQuery } from "@/src/server/http/p4-admin-conversation-schemas";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requireAdmin(request.headers);
    const query = parseAdminConversationListQuery(
      new URL(request.url).searchParams,
    );
    return jsonResponse(
      await listAdminConversations(principal, {
        ownerUserId: query.userId,
        ownerSource: query.source,
        status: query.status,
        archived: query.archived,
        cursor: query.cursor,
      }),
    );
  });
}
