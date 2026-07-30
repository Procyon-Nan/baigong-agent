import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { getAuth } from "@/src/server/auth/config";
import { requirePrincipal } from "@/src/server/authorization";
import { getDatabase } from "@/src/server/db/client";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import { handleRoute } from "@/src/server/http/responses";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requirePrincipal(request.headers, {
      allowPasswordChange: true,
    });
    const auth = await getAuth();
    const response = await auth.handler(
      new Request(new URL("/api/auth/sign-out", request.url), {
        method: "POST",
        headers: request.headers,
      }),
    );
    if (response.ok) {
      await writeSecurityAudit(getDatabase(), {
        tenantId: principal.tenantId,
        actorUserId: principal.userId,
        actorSource: principal.source,
        action: "LOGOUT_SUCCEEDED",
        targetType: "SESSION",
        targetId: principal.sessionId,
        outcome: "SUCCESS",
      });
    }
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}
