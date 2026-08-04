import { requirePrincipal } from "@/src/server/authorization";
import { listConversationUserMessageNodes } from "@/src/server/conversations/service";
import {
  parseConversationHistoryQuery,
  parseConversationId,
} from "@/src/server/http/p3-conversation-schemas";
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
      await listConversationUserMessageNodes(principal, conversationId, query),
    );
  });
}
