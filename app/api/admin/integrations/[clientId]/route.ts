import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
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
    const body = (await request.json()) as Record<string, unknown>;
    await updateEmbeddedClient(principal, clientId, {
      name: typeof body.name === "string" ? body.name : undefined,
      allowedOrigins: Array.isArray(body.allowedOrigins)
        ? body.allowedOrigins.filter(
            (origin): origin is string => typeof origin === "string",
          )
        : undefined,
      status:
        body.status === "ACTIVE" || body.status === "DISABLED"
          ? body.status
          : undefined,
    });
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
