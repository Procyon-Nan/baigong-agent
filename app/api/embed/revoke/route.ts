import { requirePrincipal } from "@/src/server/authorization";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { revokeCurrentEmbeddedSession } from "@/src/server/integrations/service";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requirePrincipal(request.headers);
    await revokeCurrentEmbeddedSession(principal);
    return jsonResponse({ success: true });
  });
}
