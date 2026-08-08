import { and, asc, eq } from "drizzle-orm";
import { getDatabase } from "@/src/server/db/client";
import {
  conversationAttachments,
  conversations,
  modelConfigVersions,
} from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import { isImageMediaType } from "./policy";
import { readAttachmentFile } from "./storage";

export type AttachmentToolAuthority = {
  readonly tenantId: string;
  readonly userId: string;
  readonly source: "LOCAL" | "EMBEDDED";
  readonly conversationId: string;
  readonly modelConfigVersionId: string;
};

export type ToolReadableAttachment = {
  readonly id: string;
  readonly displayName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
};

export async function listToolReadableAttachments(
  authority: AttachmentToolAuthority,
): Promise<readonly ToolReadableAttachment[]> {
  const database = getDatabase();
  const rootConversationId = await resolveRootConversationId(authority);
  return database
    .select({
      id: conversationAttachments.id,
      displayName: conversationAttachments.displayName,
      mediaType: conversationAttachments.declaredMediaType,
      sizeBytes: conversationAttachments.sizeBytes,
    })
    .from(conversationAttachments)
    .where(
      and(
        eq(conversationAttachments.tenantId, authority.tenantId),
        eq(conversationAttachments.ownerUserId, authority.userId),
        eq(conversationAttachments.ownerSource, authority.source),
        eq(conversationAttachments.conversationId, rootConversationId),
        eq(conversationAttachments.status, "BOUND"),
      ),
    )
    .orderBy(asc(conversationAttachments.createdAt), asc(conversationAttachments.id));
}

export async function readToolAttachment(
  authority: AttachmentToolAuthority,
  attachmentId: string,
  signal?: AbortSignal,
): Promise<ToolReadableAttachment & { readonly base64: string }> {
  const database = getDatabase();
  const rootConversationId = await resolveRootConversationId(authority);
  const [[attachment], [model]] = await Promise.all([
    database
      .select()
      .from(conversationAttachments)
      .where(
        and(
          eq(conversationAttachments.id, attachmentId),
          eq(conversationAttachments.tenantId, authority.tenantId),
          eq(conversationAttachments.ownerUserId, authority.userId),
          eq(conversationAttachments.ownerSource, authority.source),
          eq(conversationAttachments.conversationId, rootConversationId),
          eq(conversationAttachments.status, "BOUND"),
        ),
      )
      .limit(1),
    database
      .select({
        supportsImageInput: modelConfigVersions.supportsImageInput,
        supportsNativePdfInput: modelConfigVersions.supportsNativePdfInput,
      })
      .from(modelConfigVersions)
      .where(
        and(
          eq(modelConfigVersions.id, authority.modelConfigVersionId),
          eq(modelConfigVersions.tenantId, authority.tenantId),
        ),
      )
      .limit(1),
  ]);
  if (!attachment || !model) throw attachmentToolDenied();
  if (
    (isImageMediaType(attachment.declaredMediaType) &&
      !model.supportsImageInput) ||
    (attachment.declaredMediaType === "application/pdf" &&
      !model.supportsNativePdfInput)
  ) {
    throw attachmentToolDenied();
  }
  signal?.throwIfAborted();
  const bytes = await readAttachmentFile(attachment.storageKey, { signal });
  signal?.throwIfAborted();
  return {
    id: attachment.id,
    displayName: attachment.displayName,
    mediaType: attachment.declaredMediaType,
    sizeBytes: attachment.sizeBytes,
    base64: Buffer.from(bytes).toString("base64"),
  };
}

async function resolveRootConversationId(
  authority: AttachmentToolAuthority,
): Promise<string> {
  const [conversation] = await getDatabase()
    .select({
      id: conversations.id,
      kind: conversations.kind,
      parentConversationId: conversations.parentConversationId,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, authority.conversationId),
        eq(conversations.tenantId, authority.tenantId),
        eq(conversations.ownerUserId, authority.userId),
        eq(conversations.ownerSource, authority.source),
      ),
    )
    .limit(1);
  if (!conversation) throw attachmentToolDenied();
  if (conversation.kind === "MAIN") return conversation.id;
  if (!conversation.parentConversationId) throw attachmentToolDenied();
  const [parent] = await getDatabase()
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversation.parentConversationId),
        eq(conversations.tenantId, authority.tenantId),
        eq(conversations.ownerUserId, authority.userId),
        eq(conversations.ownerSource, authority.source),
        eq(conversations.kind, "MAIN"),
      ),
    )
    .limit(1);
  if (!parent) throw attachmentToolDenied();
  return parent.id;
}

function attachmentToolDenied(): ApplicationError {
  return new ApplicationError({
    code: "ATTACHMENT_TOOL_ACCESS_DENIED",
    message: "附件不可用于当前会话。",
    status: 403,
    expose: true,
  });
}
