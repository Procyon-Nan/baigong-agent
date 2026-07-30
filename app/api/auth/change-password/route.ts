import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requirePrincipal } from "@/src/server/authorization";
import { changePasswordRequestSchema } from "@/src/server/http/p2-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { changeOwnPassword } from "@/src/server/users/service";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requirePrincipal(request.headers, {
      allowPasswordChange: true,
    });
    const body = await parseJsonBody(request, changePasswordRequestSchema);
    await changeOwnPassword(principal, body.currentPassword, body.newPassword);
    return jsonResponse({ success: true });
  });
}
