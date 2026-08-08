import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import { isAdminPrincipal } from "@/src/server/auth/principal";
import { getDatabase, type Database } from "@/src/server/db/client";
import {
  conversationAttachments,
  userProfiles,
} from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import { getCurrentModelClientSettings } from "@/src/server/models/configuration";
import {
  isImageMediaType,
  MAX_USER_ATTACHMENT_BYTES,
  parseAttachmentRequestId,
  validateAttachmentMetadata,
} from "./policy";
import {
  discardStagedAttachmentFile,
  finalizeAttachmentFile,
  moveAttachmentToTrash,
  readAttachmentFile,
  removeTrashedAttachment,
  restoreTrashedAttachment,
  stageAttachmentFile,
} from "./storage";

type AttachmentRow = typeof conversationAttachments.$inferSelect;

export type PublicAttachment = {
  readonly id: string;
  readonly displayName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly status: "PENDING" | "BOUND";
  readonly createdAt: string;
  readonly boundAt: string | null;
  readonly previewUrl: string;
  readonly downloadUrl: string;
};

export type AttachmentContent = {
  readonly attachment: PublicAttachment;
  readonly bytes: Uint8Array;
};

export async function uploadAttachment(
  principal: AuthenticatedPrincipal,
  input: {
    readonly requestId: unknown;
    readonly fileName: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  },
  database: Database = getDatabase(),
): Promise<{ readonly attachment: PublicAttachment; readonly duplicate: boolean }> {
  const requestId = parseAttachmentRequestId(input.requestId);
  const metadata = validateAttachmentMetadata({
    fileName: input.fileName,
    mediaType: input.mediaType,
    sizeBytes: input.bytes.byteLength,
  });
  const existing = await findOwnedRequestAttachment(
    database,
    principal,
    requestId,
  );
  if (existing) {
    assertMatchingUpload(existing, metadata);
    return { attachment: toPublicAttachment(existing), duplicate: true };
  }
  const model = await getCurrentModelClientSettings(principal.tenantId);
  if (
    !model.available ||
    (isImageMediaType(metadata.mediaType) && !model.supportsImageInput) ||
    (metadata.mediaType === "application/pdf" &&
      !model.supportsNativePdfInput)
  ) {
    throw new ApplicationError({
      code: "MODEL_ATTACHMENT_UNSUPPORTED",
      message: isImageMediaType(metadata.mediaType)
        ? "当前模型不支持图片输入。"
        : "当前模型不支持原生 PDF 输入。",
      status: 409,
      expose: true,
    });
  }

  const staged = await stageAttachmentFile(input.bytes);
  let finalized = false;
  try {
    const result = await database.transaction(async (transaction) => {
      await lockAttachmentOwner(transaction, principal);
      const duplicate = await findOwnedRequestAttachment(
        transaction,
        principal,
        requestId,
      );
      if (duplicate) {
        assertMatchingUpload(duplicate, metadata);
        return { row: duplicate, duplicate: true } as const;
      }

      const [usage] = await transaction
        .select({
          totalBytes: sql<string>`coalesce(sum(${conversationAttachments.sizeBytes}), 0)`,
        })
        .from(conversationAttachments)
        .where(ownerConditions(principal));
      const totalBytes = Number(usage?.totalBytes ?? 0);
      if (totalBytes + metadata.sizeBytes > MAX_USER_ATTACHMENT_BYTES) {
        throw attachmentQuotaExceeded();
      }

      await finalizeAttachmentFile(staged);
      finalized = true;
      const [created] = await transaction
        .insert(conversationAttachments)
        .values({
          tenantId: principal.tenantId,
          ownerUserId: principal.userId,
          ownerSource: principal.source,
          requestId,
          storageKey: staged.storageKey,
          displayName: metadata.displayName,
          extension: metadata.extension,
          declaredMediaType: metadata.mediaType,
          sizeBytes: metadata.sizeBytes,
          status: "PENDING",
        })
        .returning();
      if (!created) throw attachmentPersistenceFailure();
      return { row: created, duplicate: false } as const;
    });
    if (result.duplicate) await discardStagedAttachmentFile(staged);
    return {
      attachment: toPublicAttachment(result.row),
      duplicate: result.duplicate,
    };
  } catch (error) {
    if (!finalized || !(await attachmentStorageKeyExists(database, staged.storageKey))) {
      await discardStagedAttachmentFile(staged);
    }
    throw error;
  }
}

export async function deletePendingAttachment(
  principal: AuthenticatedPrincipal,
  attachmentId: string,
  database: Database = getDatabase(),
): Promise<void> {
  const deletionState: {
    trashed?: Awaited<ReturnType<typeof moveAttachmentToTrash>>;
  } = {};
  try {
    await database.transaction(async (transaction) => {
      await lockAttachmentOwner(transaction, principal);
      const [attachment] = await transaction
        .select()
        .from(conversationAttachments)
        .where(
          and(
            eq(conversationAttachments.id, attachmentId),
            ownerConditions(principal),
          ),
        )
        .limit(1)
        .for("update");
      if (!attachment || attachment.status !== "PENDING") {
        throw attachmentNotFound();
      }
      deletionState.trashed = await moveAttachmentToTrash(
        attachment.storageKey,
      );
      const [deleted] = await transaction
        .delete(conversationAttachments)
        .where(
          and(
            eq(conversationAttachments.id, attachment.id),
            eq(conversationAttachments.status, "PENDING"),
          ),
        )
        .returning({ id: conversationAttachments.id });
      if (!deleted) throw attachmentPersistenceFailure();
    });
  } catch (error) {
    if (
      deletionState.trashed &&
      (await attachmentExists(database, attachmentId))
    ) {
      await restoreTrashedAttachment(deletionState.trashed);
    }
    throw error;
  }
  if (deletionState.trashed) {
    await removeTrashedAttachment(deletionState.trashed.trashPath);
  }
}

export async function getAttachmentContent(
  principal: AuthenticatedPrincipal,
  attachmentId: string,
  database: Database = getDatabase(),
): Promise<AttachmentContent> {
  const [attachment] = await database
    .select()
    .from(conversationAttachments)
    .where(
      and(
        eq(conversationAttachments.id, attachmentId),
        eq(conversationAttachments.tenantId, principal.tenantId),
      ),
    )
    .limit(1);
  if (!attachment || !canReadAttachment(principal, attachment)) {
    throw attachmentNotFound();
  }
  return {
    attachment: toPublicAttachment(attachment),
    bytes: await readAttachmentFile(attachment.storageKey),
  };
}

export function toPublicAttachment(row: AttachmentRow): PublicAttachment {
  const path = `/api/attachments/${row.id}`;
  return {
    id: row.id,
    displayName: row.displayName,
    mediaType: row.declaredMediaType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    boundAt: row.boundAt?.toISOString() ?? null,
    previewUrl: path,
    downloadUrl: `${path}?download=1`,
  };
}

async function lockAttachmentOwner(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  principal: AuthenticatedPrincipal,
): Promise<void> {
  const [owner] = await transaction
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.userId, principal.userId),
        eq(userProfiles.tenantId, principal.tenantId),
        eq(userProfiles.source, principal.source),
      ),
    )
    .limit(1)
    .for("update");
  if (!owner) throw attachmentNotFound();
}

function findOwnedRequestAttachment(
  database: Pick<Database, "select">,
  principal: AuthenticatedPrincipal,
  requestId: string,
): Promise<AttachmentRow | undefined> {
  return database
    .select()
    .from(conversationAttachments)
    .where(
      and(
        ownerConditions(principal),
        eq(conversationAttachments.requestId, requestId),
      ),
    )
    .limit(1)
    .then(([row]) => row);
}

function ownerConditions(principal: AuthenticatedPrincipal) {
  return and(
    eq(conversationAttachments.tenantId, principal.tenantId),
    eq(conversationAttachments.ownerUserId, principal.userId),
    eq(conversationAttachments.ownerSource, principal.source),
  );
}

function assertMatchingUpload(
  attachment: AttachmentRow,
  metadata: ReturnType<typeof validateAttachmentMetadata>,
): void {
  if (
    attachment.displayName !== metadata.displayName ||
    attachment.extension !== metadata.extension ||
    attachment.declaredMediaType !== metadata.mediaType ||
    attachment.sizeBytes !== metadata.sizeBytes
  ) {
    throw new ApplicationError({
      code: "ATTACHMENT_REQUEST_CONFLICT",
      message: "同一附件请求标识已用于不同文件。",
      status: 409,
      expose: true,
    });
  }
}

function canReadAttachment(
  principal: AuthenticatedPrincipal,
  attachment: AttachmentRow,
): boolean {
  return (
    isAdminPrincipal(principal) ||
    (attachment.ownerUserId === principal.userId &&
      attachment.ownerSource === principal.source)
  );
}

async function attachmentStorageKeyExists(
  database: Database,
  storageKey: string,
): Promise<boolean> {
  const [row] = await database
    .select({ id: conversationAttachments.id })
    .from(conversationAttachments)
    .where(eq(conversationAttachments.storageKey, storageKey))
    .limit(1);
  return Boolean(row);
}

async function attachmentExists(
  database: Database,
  attachmentId: string,
): Promise<boolean> {
  const [row] = await database
    .select({ id: conversationAttachments.id })
    .from(conversationAttachments)
    .where(eq(conversationAttachments.id, attachmentId))
    .limit(1);
  return Boolean(row);
}

function attachmentNotFound(): ApplicationError {
  return new ApplicationError({
    code: "ATTACHMENT_NOT_FOUND",
    message: "附件不存在。",
    status: 404,
    expose: true,
  });
}

function attachmentQuotaExceeded(): ApplicationError {
  return new ApplicationError({
    code: "ATTACHMENT_QUOTA_EXCEEDED",
    message: "附件存储额度已用尽。",
    status: 409,
    expose: true,
  });
}

function attachmentPersistenceFailure(): ApplicationError {
  return new ApplicationError({
    code: "ATTACHMENT_PERSISTENCE_FAILURE",
    message: "附件信息保存失败。",
    status: 503,
    expose: true,
  });
}
