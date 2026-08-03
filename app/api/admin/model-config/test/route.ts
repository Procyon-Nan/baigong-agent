import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { testModelConfigurationRequestSchema } from "@/src/server/http/p3-model-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { testModelConfiguration } from "@/src/server/models/service";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const body = await parseJsonBody(
      request,
      testModelConfigurationRequestSchema,
    );
    return jsonResponse({
      result: await testModelConfiguration(principal, body),
    });
  });
}
