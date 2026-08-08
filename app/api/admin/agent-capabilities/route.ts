import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { saveAgentCapabilitiesRequestSchema } from "@/src/server/http/p5-agent-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import {
  getCurrentAgentCapabilities,
  saveAgentCapabilities,
} from "@/src/server/agents/service";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requireAdmin(request.headers);
    return jsonResponse({
      capabilities: await getCurrentAgentCapabilities(principal),
    });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const body = await parseJsonBody(
      request,
      saveAgentCapabilitiesRequestSchema,
    );
    return jsonResponse({
      capabilities: await saveAgentCapabilities(principal, body),
    });
  });
}
