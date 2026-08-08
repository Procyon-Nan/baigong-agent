import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import {
  parseSkillId,
  updateSkillRequestSchema,
} from "@/src/server/http/p5-agent-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { updateSkill } from "@/src/server/skills/service";

type RouteContext = { params: Promise<{ skillId: string }> };

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const skillId = parseSkillId((await context.params).skillId);
    const body = await parseJsonBody(request, updateSkillRequestSchema);
    return jsonResponse({ skill: await updateSkill(principal, skillId, body) });
  });
}
