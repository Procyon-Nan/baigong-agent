import "server-only";

import { and, asc, eq, lt } from "drizzle-orm";
import { getDatabase, type Database } from "@/src/server/db/client";
import { conversationAttachments } from "@/src/server/db/schema";
import { PENDING_ATTACHMENT_LIFETIME_MS } from "./policy";
import {
  moveAttachmentToTrash,
  reconcileAttachmentWorkingFiles,
  removeTrashedAttachment,
  restoreTrashedAttachment,
} from "./storage";

export async function cleanupExpiredPendingAttachments(
  options: {
    readonly now?: Date;
    readonly limit?: number;
    readonly database?: Database;
  } = {},
): Promise<{
  readonly deletedAttachments: number;
  readonly removedTemporary: number;
  readonly reconciledTrash: number;
}> {
  const database = options.database ?? getDatabase();
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - PENDING_ATTACHMENT_LIFETIME_MS);
  const limit = Math.min(1_000, Math.max(1, options.limit ?? 100));
  const candidates = await database
    .select({ id: conversationAttachments.id })
    .from(conversationAttachments)
    .where(
      and(
        eq(conversationAttachments.status, "PENDING"),
        lt(conversationAttachments.createdAt, cutoff),
      ),
    )
    .orderBy(asc(conversationAttachments.createdAt), asc(conversationAttachments.id))
    .limit(limit);

  let deletedAttachments = 0;
  for (const candidate of candidates) {
    if (await deleteExpiredAttachment(database, candidate.id, cutoff)) {
      deletedAttachments += 1;
    }
  }
  const workingFiles = await reconcileAttachmentWorkingFiles(
    cutoff,
    async (storageKey) => {
      const [row] = await database
        .select({ id: conversationAttachments.id })
        .from(conversationAttachments)
        .where(eq(conversationAttachments.storageKey, storageKey))
        .limit(1);
      return Boolean(row);
    },
  );
  return { deletedAttachments, ...workingFiles };
}

async function deleteExpiredAttachment(
  database: Database,
  attachmentId: string,
  cutoff: Date,
): Promise<boolean> {
  const state: {
    trashed?: Awaited<ReturnType<typeof moveAttachmentToTrash>>;
  } = {};
  let deleted = false;
  try {
    await database.transaction(async (transaction) => {
      const [attachment] = await transaction
        .select()
        .from(conversationAttachments)
        .where(
          and(
            eq(conversationAttachments.id, attachmentId),
            eq(conversationAttachments.status, "PENDING"),
            lt(conversationAttachments.createdAt, cutoff),
          ),
        )
        .limit(1)
        .for("update");
      if (!attachment) return;
      state.trashed = await moveAttachmentToTrash(attachment.storageKey);
      const [removed] = await transaction
        .delete(conversationAttachments)
        .where(
          and(
            eq(conversationAttachments.id, attachment.id),
            eq(conversationAttachments.status, "PENDING"),
          ),
        )
        .returning({ id: conversationAttachments.id });
      deleted = Boolean(removed);
    });
  } catch (error) {
    if (state.trashed && (await attachmentExists(database, attachmentId))) {
      await restoreTrashedAttachment(state.trashed);
    }
    throw error;
  }
  if (state.trashed) await removeTrashedAttachment(state.trashed.trashPath);
  return deleted;
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
