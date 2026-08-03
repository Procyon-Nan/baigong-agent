import { requirePrincipal } from "@/src/server/authorization";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { getCurrentModelClientSettings } from "@/src/server/models/service";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requirePrincipal(request.headers);
    return jsonResponse({
      model: await getCurrentModelClientSettings(principal.tenantId),
    });
  });
}
