import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { updateEmbeddedClientRequestSchema } from "@/src/server/http/p2-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import {
  deleteEmbeddedClient,
  updateEmbeddedClient,
} from "@/src/server/integrations/service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const { clientId } = await context.params;
    const body = await parseJsonBody(
      request,
      updateEmbeddedClientRequestSchema,
    );
    await updateEmbeddedClient(principal, clientId, body);
    return jsonResponse({ success: true });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const { clientId } = await context.params;
    await deleteEmbeddedClient(principal, clientId);
    return jsonResponse({ success: true });
  });
}
