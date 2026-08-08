import { z } from "zod";
import { ApplicationError } from "@/src/server/errors";

const attachmentIdSchema = z.uuid();

export function parseAttachmentId(value: string): string {
  const parsed = attachmentIdSchema.safeParse(value);
  if (!parsed.success) throw invalidAttachmentRequest();
  return parsed.data;
}

export function parseAttachmentDownload(value: string | null): boolean {
  if (value === null) return false;
  if (value !== "1") throw invalidAttachmentRequest();
  return true;
}

export function invalidAttachmentRequest(cause?: unknown): ApplicationError {
  return new ApplicationError({
    code: "INVALID_ATTACHMENT_REQUEST",
    message: "附件请求无效。",
    status: 400,
    expose: true,
    cause,
  });
}
