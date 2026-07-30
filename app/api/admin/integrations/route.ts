import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import {
  createEmbeddedClient,
  listEmbeddedClients,
} from "@/src/server/integrations/service";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requireAdmin(request.headers);
    return jsonResponse({
      clients: await listEmbeddedClients(principal.tenantId),
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await createEmbeddedClient(principal, {
      name: typeof body.name === "string" ? body.name : "",
      allowedOrigins: Array.isArray(body.allowedOrigins)
        ? body.allowedOrigins.filter(
            (origin): origin is string => typeof origin === "string",
          )
        : [],
    });
    return jsonResponse(result, { status: 201 });
  });
}
