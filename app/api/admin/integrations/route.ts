import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { createEmbeddedClientRequestSchema } from "@/src/server/http/p2-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import {
  createEmbeddedClient,
  listEmbeddedClients,
} from "@/src/server/integrations/service";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requireAdmin(request.headers);
    return jsonResponse({
      clients: await listEmbeddedClients(principal),
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const body = await parseJsonBody(
      request,
      createEmbeddedClientRequestSchema,
    );
    const result = await createEmbeddedClient(principal, body);
    return jsonResponse(result, { status: 201 });
  });
}
