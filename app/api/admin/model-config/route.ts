import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requireAdmin } from "@/src/server/authorization";
import { saveModelConfigurationRequestSchema } from "@/src/server/http/p3-model-schemas";
import { parseJsonBody } from "@/src/server/http/request";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import {
  deleteModelConfiguration,
  getCurrentModelConfiguration,
  saveModelConfiguration,
} from "@/src/server/models/service";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requireAdmin(request.headers);
    return jsonResponse({
      configuration: await getCurrentModelConfiguration(principal),
    });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    const body = await parseJsonBody(
      request,
      saveModelConfigurationRequestSchema,
    );
    return jsonResponse({
      configuration: await saveModelConfiguration(principal, body),
    });
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requireAdmin(request.headers);
    return jsonResponse({
      deleted: await deleteModelConfiguration(principal),
    });
  });
}
