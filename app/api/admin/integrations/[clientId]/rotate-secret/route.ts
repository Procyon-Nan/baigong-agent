import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { rotateEmbeddedClientSecret } from "@/src/server/integrations/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const { clientId } = await context.params;
    const clientSecret = await rotateEmbeddedClientSecret(principal, clientId);
    return jsonResponse({ clientSecret });
  });
}
