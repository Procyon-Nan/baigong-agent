import { parseClientCredentials } from "@/src/server/integrations/credentials";
import { issueEmbeddedTicket } from "@/src/server/integrations/service";
import { requestSource } from "@/src/server/auth/login-protection";
import { issueEmbeddedTicketRequestSchema } from "@/src/server/http/p2-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const credentials = parseClientCredentials(request);
    const body = await parseJsonBody(request, issueEmbeddedTicketRequestSchema);
    const result = await issueEmbeddedTicket({
      requestSource: requestSource(request),
      ...credentials,
      ...body,
    });
    return jsonResponse(result, { status: 201 });
  });
}
