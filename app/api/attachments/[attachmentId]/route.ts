import { assertSameOriginRequest } from "@/src/server/auth/origin";
import { requirePrincipal } from "@/src/server/authorization";
import {
  deletePendingAttachment,
  getAttachmentContent,
} from "@/src/server/attachments/service";
import {
  parseAttachmentDownload,
  parseAttachmentId,
} from "@/src/server/http/p5-attachment-schemas";
import { handleRoute, jsonResponse } from "@/src/server/http/responses";

type RouteContext = { params: Promise<{ attachmentId: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    const principal = await requirePrincipal(request.headers);
    const { attachmentId: rawAttachmentId } = await context.params;
    const attachmentId = parseAttachmentId(rawAttachmentId);
    const download = parseAttachmentDownload(
      new URL(request.url).searchParams.get("download"),
    );
    const { attachment, bytes } = await getAttachmentContent(
      principal,
      attachmentId,
    );
    return new Response(Uint8Array.from(bytes).buffer, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": contentDisposition(
          attachment.displayName,
          download,
        ),
        "content-length": String(bytes.byteLength),
        "content-type": attachment.mediaType,
        "x-content-type-options": "nosniff",
      },
    });
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    assertSameOriginRequest(request);
    const principal = await requirePrincipal(request.headers);
    const { attachmentId: rawAttachmentId } = await context.params;
    await deletePendingAttachment(
      principal,
      parseAttachmentId(rawAttachmentId),
    );
    return jsonResponse({ deleted: true });
  });
}

function contentDisposition(fileName: string, download: boolean): string {
  const disposition = download ? "attachment" : "inline";
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
