import { after } from "next/server";
import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requirePrincipal } from "@/src/server/authorization";
import { createConversation } from "@/src/server/conversations/service";
import {
  P3_CONVERSATION_REQUEST_MAX_BYTES,
  createConversationMessageSchema,
} from "@/src/server/http/p3-conversation-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";

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
