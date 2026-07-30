import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { loginWithIdentifier } from "@/src/server/auth/local-login";
import { handleRoute } from "@/src/server/http/responses";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const body = (await request.json()) as {
      identifier?: unknown;
      password?: unknown;
    };
    return loginWithIdentifier(
      request,
      typeof body.identifier === "string" ? body.identifier : "",
      typeof body.password === "string" ? body.password : "",
    );
  });
}
