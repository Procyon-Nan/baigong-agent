import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import { conversationAttachments } from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import type { ReservedConversationAttachment } from "@/src/server/conversations/types";
import type { ConversationTransaction } from "@/src/server/conversations/repository-types";
import {
  assertMessageAttachmentLimits,
  isImageMediaType,
} from "./policy";

type ModelAttachmentCapabilities = {
  readonly supportsImageInput: boolean;
  readonly supportsNativePdfInput: boolean;
};

export async function bindPendingAttachments(
  transaction: ConversationTransaction,
  input: {
    readonly principal: AuthenticatedPrincipal;
    readonly attachmentIds: readonly string[];
    readonly conversationId: string;
    readonly messageId: string;
    readonly model: ModelAttachmentCapabilities;
    readonly boundAt: Date;
  },
): Promise<ReservedConversationAttachment[]> {
  const attachmentIds = normalizeAttachmentIds(input.attachmentIds);
  if (attachmentIds.length === 0) return [];
  const rows = await transaction
    .select()
    .from(conversationAttachments)
    .where(
      and(
        eq(conversationAttachments.tenantId, input.principal.tenantId),
        eq(conversationAttachments.ownerUserId, input.principal.userId),
        eq(conversationAttachments.ownerSource, input.principal.source),
        inArray(conversationAttachments.id, attachmentIds),
      ),
    )
    .for("update");
  if (rows.length !== attachmentIds.length) throw attachmentBindingFailure();
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  const ordered = attachmentIds.map((id) => {
    const attachment = byId.get(id);
    if (!attachment || attachment.status !== "PENDING") {
      throw attachmentBindingFailure();
    }
    return attachment;
  });
  assertMessageAttachmentLimits(ordered);
  assertModelAttachmentCapabilities(ordered, input.model);

  const updated = await transaction
    .update(conversationAttachments)
    .set({
      status: "BOUND",
      conversationId: input.conversationId,
      messageId: input.messageId,
      boundAt: input.boundAt,
    })
    .where(
      and(
        eq(conversationAttachments.status, "PENDING"),
        inArray(conversationAttachments.id, attachmentIds),
      ),
    )
    .returning({ id: conversationAttachments.id });
  if (updated.length !== attachmentIds.length) throw attachmentBindingFailure();
  return ordered.map(toReservedAttachment);
}

export async function listBoundMessageAttachments(
  transaction: ConversationTransaction,
  input: {
    readonly principal: AuthenticatedPrincipal;
    readonly conversationId: string;
    readonly messageId: string;
    readonly model: ModelAttachmentCapabilities;
  },
): Promise<ReservedConversationAttachment[]> {
  const rows = await transaction
    .select()
    .from(conversationAttachments)
    .where(
      and(
        eq(conversationAttachments.tenantId, input.principal.tenantId),
        eq(conversationAttachments.ownerUserId, input.principal.userId),
        eq(conversationAttachments.ownerSource, input.principal.source),
        eq(conversationAttachments.conversationId, input.conversationId),
        eq(conversationAttachments.messageId, input.messageId),
        eq(conversationAttachments.status, "BOUND"),
      ),
    )
    .orderBy(conversationAttachments.createdAt, conversationAttachments.id);
  assertMessageAttachmentLimits(rows);
  assertModelAttachmentCapabilities(rows, input.model);
  return rows.map(toReservedAttachment);
}

function normalizeAttachmentIds(values: readonly string[]): string[] {
  const unique = [...new Set(values)];
  if (unique.length !== values.length) throw attachmentBindingFailure();
  return unique;
}

function assertModelAttachmentCapabilities(
  attachments: readonly { readonly declaredMediaType: string }[],
  model: ModelAttachmentCapabilities,
): void {
  if (
    attachments.some(({ declaredMediaType }) =>
      isImageMediaType(declaredMediaType),
    ) &&
    !model.supportsImageInput
  ) {
    throw unsupportedAttachment("当前模型不支持图片输入。");
  }
  if (
    attachments.some(
      ({ declaredMediaType }) => declaredMediaType === "application/pdf",
    ) &&
    !model.supportsNativePdfInput
  ) {
    throw unsupportedAttachment("当前模型不支持原生 PDF 输入。");
  }
}

function toReservedAttachment(attachment: {
  readonly id: string;
  readonly storageKey: string;
  readonly displayName: string;
  readonly declaredMediaType: string;
  readonly sizeBytes: number;
}): ReservedConversationAttachment {
  return {
    id: attachment.id,
    storageKey: attachment.storageKey,
    displayName: attachment.displayName,
    mediaType: attachment.declaredMediaType,
    sizeBytes: attachment.sizeBytes,
  };
}

function attachmentBindingFailure(): ApplicationError {
  return new ApplicationError({
    code: "ATTACHMENT_BINDING_FAILED",
    message: "附件不可用于当前消息。",
    status: 409,
    expose: true,
  });
}

function unsupportedAttachment(message: string): ApplicationError {
  return new ApplicationError({
    code: "MODEL_ATTACHMENT_UNSUPPORTED",
    message,
    status: 409,
    expose: true,
  });
}
