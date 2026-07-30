import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { revokeManagedUserSessions } from "@/src/server/users/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const { userId } = await context.params;
    await revokeManagedUserSessions(principal, userId);
    return jsonResponse({ success: true });
  });
}
