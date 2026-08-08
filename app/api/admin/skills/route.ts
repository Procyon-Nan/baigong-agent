import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { createSkillRequestSchema } from "@/src/server/http/p5-agent-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { createSkill, listSkills } from "@/src/server/skills/service";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requireAdmin(request.headers);
    return jsonResponse({ skills: await listSkills(principal) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const body = await parseJsonBody(request, createSkillRequestSchema);
    return jsonResponse({ skill: await createSkill(principal, body) }, { status: 201 });
  });
}
