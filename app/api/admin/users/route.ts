import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { createUserRequestSchema } from "@/src/server/http/p2-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { createLocalUser, listUsers } from "@/src/server/users/service";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requireAdmin(request.headers);
    return jsonResponse({ users: await listUsers(principal) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const body = await parseJsonBody(request, createUserRequestSchema);
    const result = await createLocalUser({
      ...body,
      actor: principal,
    });
    return jsonResponse(result, { status: 201 });
  });
}
