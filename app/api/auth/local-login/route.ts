import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { loginWithIdentifier } from "@/src/server/auth/local-login";
import { localLoginRequestSchema } from "@/src/server/http/p2-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute } from "@/src/server/http/responses";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const body = await parseJsonBody(request, localLoginRequestSchema);
    return loginWithIdentifier(request, body.identifier, body.password);
  });
}
