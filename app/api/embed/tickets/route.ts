import { parseClientCredentials } from "@/src/server/integrations/credentials";
import { issueEmbeddedTicket } from "@/src/server/integrations/service";
import { requestSource } from "@/src/server/auth/login-protection";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const credentials = parseClientCredentials(request);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await issueEmbeddedTicket({
      requestSource: requestSource(request),
      ...credentials,
      externalUserId:
        typeof body.externalUserId === "string" ? body.externalUserId : "",
      origin: typeof body.origin === "string" ? body.origin : "",
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
      displayName:
        typeof body.displayName === "string" ? body.displayName : undefined,
      displayEmail:
        typeof body.displayEmail === "string" ? body.displayEmail : undefined,
    });
    return jsonResponse(result, { status: 201 });
  });
}
