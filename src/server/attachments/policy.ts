import { extname, basename } from "node:path";
import { z } from "zod";
import { ApplicationError } from "@/src/server/errors";

export const MAX_ATTACHMENT_BYTES = 20 * 1_024 * 1_024;
export const MAX_MESSAGE_ATTACHMENTS = 5;
export const MAX_MESSAGE_ATTACHMENT_BYTES = 50 * 1_024 * 1_024;
export const MAX_USER_ATTACHMENT_BYTES = 1_024 * 1_024 * 1_024;
export const PENDING_ATTACHMENT_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const ATTACHMENT_REQUEST_MAX_BYTES = MAX_ATTACHMENT_BYTES + 64 * 1_024;

const mediaTypesByExtension = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
} as const;

export type AllowedAttachmentExtension = keyof typeof mediaTypesByExtension;
export type AllowedAttachmentMediaType =
  (typeof mediaTypesByExtension)[AllowedAttachmentExtension];

export type ValidatedAttachmentMetadata = {
  readonly displayName: string;
  readonly extension: AllowedAttachmentExtension;
  readonly mediaType: AllowedAttachmentMediaType;
  readonly sizeBytes: number;
};

export function validateAttachmentMetadata(input: {
  readonly fileName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
}): ValidatedAttachmentMetadata {
  const displayName = sanitizeDisplayName(input.fileName);
  const extension = extname(displayName).toLowerCase();
  if (!isAllowedAttachmentExtension(extension)) {
    throw invalidAttachment("不支持该附件格式。");
  }
  if (mediaTypesByExtension[extension] !== input.mediaType) {
    throw invalidAttachment("附件扩展名与声明类型不一致。");
  }
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_ATTACHMENT_BYTES
  ) {
    throw new ApplicationError({
      code: "ATTACHMENT_SIZE_INVALID",
      message: "附件大小必须大于 0 且不超过 20 MiB。",
      status: 413,
      expose: true,
    });
  }
  return {
    displayName,
    extension,
    mediaType: input.mediaType as AllowedAttachmentMediaType,
    sizeBytes: input.sizeBytes,
  };
}

export function parseAttachmentRequestId(value: unknown): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw invalidAttachment("附件请求标识无效。");
  return parsed.data;
}

export function assertMessageAttachmentLimits(
  attachments: readonly { readonly sizeBytes: number }[],
): void {
  if (attachments.length > MAX_MESSAGE_ATTACHMENTS) {
    throw invalidAttachment("每条消息最多包含 5 个附件。");
  }
  const totalBytes = attachments.reduce(
    (total, attachment) => total + attachment.sizeBytes,
    0,
  );
  if (totalBytes > MAX_MESSAGE_ATTACHMENT_BYTES) {
    throw invalidAttachment("每条消息的附件总大小不能超过 50 MiB。");
  }
}

export function isImageMediaType(
  value: string,
): value is "image/png" | "image/jpeg" | "image/webp" {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

function sanitizeDisplayName(value: string): string {
  const normalized = basename(value.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!normalized || Array.from(normalized).length > 240) {
    throw invalidAttachment("附件文件名无效。");
  }
  return normalized;
}

function isAllowedAttachmentExtension(
  value: string,
): value is AllowedAttachmentExtension {
  return Object.hasOwn(mediaTypesByExtension, value);
}

function invalidAttachment(message: string): ApplicationError {
  return new ApplicationError({
    code: "INVALID_ATTACHMENT",
    message,
    status: 400,
    expose: true,
  });
}
