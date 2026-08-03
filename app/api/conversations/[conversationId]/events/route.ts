import { resolvePrincipal, requirePrincipal } from "@/src/server/authorization";
import {
  parseConversationEventCursor,
  parseConversationId,
} from "@/src/server/http/p3-conversation-schemas";
import { errorResponse } from "@/src/server/http/responses";
import { streamConversationEvents } from "@/src/server/eve/streams";

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const principal = await requirePrincipal(request.headers);
    const { conversationId: rawConversationId } = await context.params;
    const conversationId = parseConversationId(rawConversationId);
    const after = parseConversationEventCursor(
      new URL(request.url).searchParams.get("after"),
    );
    const stream = await streamConversationEvents({
      principal,
      conversationId,
      after,
      requestSignal: request.signal,
      reauthorize: () => resolvePrincipal(request.headers),
    });
    return new Response(stream, {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
