import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { updateManagedUser } from "@/src/server/users/service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const { userId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    await updateManagedUser(principal, userId, {
      status:
        body.status === "ACTIVE" || body.status === "DISABLED"
          ? body.status
          : undefined,
      role:
        body.role === "USER" || body.role === "ADMIN" ? body.role : undefined,
    });
    return jsonResponse({ success: true });
  });
}
