import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requirePrincipal } from "@/src/server/authorization";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { changeOwnPassword } from "@/src/server/users/service";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requirePrincipal(request.headers, {
      allowPasswordChange: true,
    });
    const body = (await request.json()) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };
    await changeOwnPassword(
      principal,
      typeof body.currentPassword === "string" ? body.currentPassword : "",
      typeof body.newPassword === "string" ? body.newPassword : "",
    );
    return jsonResponse({ success: true });
  });
}
