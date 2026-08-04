import "server-only";

import { and, eq, or, sql } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import type { AdminPrincipal } from "@/src/server/auth/principal";
import { getDatabase, type Database } from "@/src/server/db/client";
import { conversations, type ConversationStatus } from "@/src/server/db/schema";
import {
  adminConversationQuery,
  readAdminConversationOwner,
  toAdminConversationOwner,
} from "./admin-conversation-query";
import type {
  AdminConversationTarget,
  AdminSubagentIndexEntry,
} from "./admin-conversation-types";
import { conversationBusy, conversationNotFound } from "./errors";
import {
  readActiveTurn,
  toPublicConversation,
} from "./public-conversation";

const ACTIVE_STATUSES: ReadonlySet<ConversationStatus> = new Set([
  "STARTING",
  "RUNNING",
  "CANCELLING",
]);

export type AdminConversationRepository = ReturnType<
  typeof createAdminConversationRepository
>;

export function createAdminConversationRepository(
  database: Database = getDatabase(),
) {
  return {
    async findTarget(
      principal: AdminPrincipal,
      conversationId: string,
    ): Promise<AdminConversationTarget | null> {
      const [row] = await adminConversationQuery(database)
        .where(
          and(
            eq(conversations.tenantId, principal.tenantId),
            eq(conversations.id, conversationId),
            or(
              eq(conversations.kind, "MAIN"),
              and(
                eq(conversations.kind, "SUBAGENT"),
                eq(conversations.linkStatus, "VERIFIED"),
              ),
            ),
          ),
        )
        .limit(1);
      if (!row) return null;
      const activeTurn = row.conversation.activeTurnId
        ? await readActiveTurn(database, row.conversation.activeTurnId)
        : undefined;
      return {
        conversation: {
          ...toPublicConversation(row.conversation, activeTurn),
          kind: row.conversation.kind,
          linkStatus: row.conversation.linkStatus,
          parentConversationId: row.conversation.parentConversationId,
          subagentName: row.conversation.subagentName,
        },
        owner: toAdminConversationOwner(row),
      };
    },

    async listSubagentTree(
      tenantId: string,
      conversationId: string,
    ): Promise<readonly AdminSubagentIndexEntry[]> {
      const result = await database.execute<{
        conversationId: string;
        parentConversationId: string;
        name: string;
        status: AdminSubagentIndexEntry["status"];
        linkStatus: AdminSubagentIndexEntry["linkStatus"];
        depth: number;
        createdAt: Date | string;
        updatedAt: Date | string;
      }>(sql`
        WITH RECURSIVE subagent_tree AS (
          SELECT
            child.id,
            child.parent_conversation_id,
            child.subagent_name,
            child.status,
            child.link_status,
            child.created_at,
            child.updated_at,
            1 AS depth
          FROM conversations AS child
          WHERE child.tenant_id = ${tenantId}::uuid
            AND child.parent_conversation_id = ${conversationId}::uuid
            AND child.kind = 'SUBAGENT'

          UNION ALL

          SELECT
            child.id,
            child.parent_conversation_id,
            child.subagent_name,
            child.status,
            child.link_status,
            child.created_at,
            child.updated_at,
            parent.depth + 1
          FROM conversations AS child
          INNER JOIN subagent_tree AS parent
            ON child.parent_conversation_id = parent.id
          WHERE child.tenant_id = ${tenantId}::uuid
            AND child.kind = 'SUBAGENT'
        )
        SELECT
          id AS "conversationId",
          parent_conversation_id AS "parentConversationId",
          subagent_name AS "name",
          status,
          link_status AS "linkStatus",
          depth,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM subagent_tree
        ORDER BY created_at ASC, id ASC
      `);
      return result.rows.map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
      }));
    },

    recordViewed(
      principal: AdminPrincipal,
      target: AdminConversationTarget,
    ): Promise<void> {
      return writeSecurityAudit(database, {
        tenantId: principal.tenantId,
        actorUserId: principal.userId,
        actorSource: "LOCAL",
        action: "ADMIN_CONVERSATION_VIEWED",
        targetType: "CONVERSATION",
        targetId: target.conversation.id,
        outcome: "SUCCESS",
        metadata: {
          ownerUserId: target.owner.userId,
          conversationKind: target.conversation.kind,
        },
      });
    },

    recordExecutionIndexViewed(
      principal: AdminPrincipal,
      target: AdminConversationTarget,
    ): Promise<void> {
      return writeSecurityAudit(database, {
        tenantId: principal.tenantId,
        actorUserId: principal.userId,
        actorSource: "LOCAL",
        action: "ADMIN_CONVERSATION_EXECUTION_INDEX_VIEWED",
        targetType: "CONVERSATION",
        targetId: target.conversation.id,
        outcome: "SUCCESS",
        metadata: {
          ownerUserId: target.owner.userId,
          conversationKind: target.conversation.kind,
        },
      });
    },

    async archiveMain(
      principal: AdminPrincipal,
      conversationId: string,
    ): Promise<AdminConversationTarget> {
      return database.transaction(async (transaction) => {
        const [conversation] = await transaction
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, principal.tenantId),
              eq(conversations.id, conversationId),
              eq(conversations.kind, "MAIN"),
            ),
          )
          .limit(1)
          .for("update");
        if (!conversation) throw conversationNotFound();
        if (ACTIVE_STATUSES.has(conversation.status)) throw conversationBusy();

        const now = new Date();
        const archived = conversation.archivedAt
          ? conversation
          : (
              await transaction
                .update(conversations)
                .set({ archivedAt: now, updatedAt: now })
                .where(eq(conversations.id, conversation.id))
                .returning()
            )[0];
        if (!archived) throw conversationNotFound();
        const owner = await readAdminConversationOwner(
          transaction,
          archived.ownerUserId,
        );
        const target: AdminConversationTarget = {
          conversation: {
            ...toPublicConversation(archived),
            kind: archived.kind,
            linkStatus: archived.linkStatus,
            parentConversationId: archived.parentConversationId,
            subagentName: archived.subagentName,
          },
          owner,
        };
        await writeSecurityAudit(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          actorSource: "LOCAL",
          action: "CONVERSATION_ARCHIVED_BY_ADMIN",
          targetType: "CONVERSATION",
          targetId: conversation.id,
          outcome: "SUCCESS",
          metadata: { ownerUserId: conversation.ownerUserId },
        });
        return target;
      });
    },
  };
}
