import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { updateUserRequestSchema } from "@/src/server/http/p2-schemas";
import { parseJsonBody } from "@/src/server/http/request";
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
    const body = await parseJsonBody(request, updateUserRequestSchema);
    await updateManagedUser(principal, userId, body);
    return jsonResponse({ success: true });
  });
}
