import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { createLocalUser, listUsers } from "@/src/server/users/service";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requireAdmin(request.headers);
    return jsonResponse({ users: await listUsers(principal.tenantId) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await createLocalUser({
      username: typeof body.username === "string" ? body.username : "",
      email: typeof body.email === "string" ? body.email : "",
      displayName: typeof body.displayName === "string" ? body.displayName : "",
      role: body.role === "ADMIN" ? "ADMIN" : "USER",
      actor: principal,
    });
    return jsonResponse(result, { status: 201 });
  });
}
