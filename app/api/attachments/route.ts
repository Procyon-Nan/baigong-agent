import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requirePrincipal } from "@/src/server/authorization";
import { uploadAttachment } from "@/src/server/attachments/service";
import { ATTACHMENT_REQUEST_MAX_BYTES } from "@/src/server/attachments/policy";
import { invalidAttachmentRequest } from "@/src/server/http/p5-attachment-schemas";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";
import { ApplicationError } from "@/src/server/errors";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requirePrincipal(request.headers);
    assertRequestSize(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch (error) {
      throw invalidAttachmentRequest(error);
    }
    const requestId = form.get("requestId");
    const file = form.get("file");
    if (typeof requestId !== "string" || !(file instanceof File)) {
      throw invalidAttachmentRequest();
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadAttachment(principal, {
      requestId,
      fileName: file.name,
      mediaType: file.type,
      bytes,
    });
    return jsonResponse(result, { status: result.duplicate ? 200 : 201 });
  });
}

function assertRequestSize(request: Request): void {
  const value = request.headers.get("content-length");
  if (value === null) return;
  if (!/^\d+$/.test(value)) throw invalidAttachmentRequest();
  if (Number(value) > ATTACHMENT_REQUEST_MAX_BYTES) {
    throw new ApplicationError({
      code: "REQUEST_BODY_TOO_LARGE",
      message: "请求内容过大。",
      status: 413,
      expose: true,
    });
  }
}
