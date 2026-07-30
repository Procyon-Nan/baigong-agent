import { resolvePrincipal } from "@/src/server/authorization";
import { ApplicationError } from "@/src/server/errors";
import { exchangeEmbeddedTicketRequestSchema } from "@/src/server/http/p2-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { exchangeEmbeddedTicket } from "@/src/server/integrations/service";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = await parseJsonBody(
      request,
      exchangeEmbeddedTicketRequestSchema,
    );
    const hasPreviousToken = request.headers.has("authorization");
    const previousPrincipal = hasPreviousToken
      ? await resolvePrincipal(request.headers)
      : null;
    if (hasPreviousToken && !previousPrincipal) {
      throw new ApplicationError({
        code: "INVALID_EMBEDDED_SESSION",
        message: "嵌入会话无效。",
        status: 401,
        expose: true,
      });
    }
    const result = await exchangeEmbeddedTicket({
      ticket: body.ticket,
      origin: body.origin,
      previousPrincipal,
    });
    return jsonResponse({
      token: result.token,
      expiresAt: result.expiresAt,
      user: {
        id: result.principal.userId,
        displayName: result.principal.displayName,
        role: result.principal.role,
      },
    });
  });
}
