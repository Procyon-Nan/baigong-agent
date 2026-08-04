import { after } from "next/server";
import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requirePrincipal } from "@/src/server/authorization";
import {
  createConversation,
  listConversations,
} from "@/src/server/conversations/service";
import {
  P3_CONVERSATION_REQUEST_MAX_BYTES,
  createConversationMessageSchema,
  parseConversationListQuery,
} from "@/src/server/http/p3-conversation-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requirePrincipal(request.headers);
    const query = parseConversationListQuery(new URL(request.url).searchParams);
    const result = await listConversations(principal, {
      ...query,
      archived: query.archived === "true",
    });
    return jsonResponse(result);
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requirePrincipal(request.headers);
    const body = await parseJsonBody(request, createConversationMessageSchema, {
      maxBytes: P3_CONVERSATION_REQUEST_MAX_BYTES,
    });
    const submission = await createConversation(principal, body);
    if (submission.monitor) after(submission.monitor);
    return jsonResponse(
      {
        conversation: submission.conversation,
        turn: submission.turn,
        duplicate: submission.duplicate,
      },
      { status: submission.duplicate ? 200 : 201 },
    );
  });
}
