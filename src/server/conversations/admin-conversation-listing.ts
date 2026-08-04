import "server-only";

import { and, desc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { AdminPrincipal } from "@/src/server/auth/principal";
import { getDatabase, type Database } from "@/src/server/db/client";
import { conversations } from "@/src/server/db/schema";
import {
  encodeAdminConversationListCursor,
  type AdminConversationListCursor,
} from "./admin-conversation-cursors";
import {
  adminConversationQuery,
  toAdminConversationOwner,
} from "./admin-conversation-query";
import type {
  AdminConversationFilters,
  AdminConversationListPage,
} from "./admin-conversation-types";
import { invalidConversationCursor } from "./errors";
import { readActiveTurns, toPublicConversation } from "./public-conversation";
import { CONVERSATION_LIST_PAGE_SIZE } from "./types";

export type AdminConversationListingRepository = ReturnType<
  typeof createAdminConversationListingRepository
>;

export function createAdminConversationListingRepository(
  database: Database = getDatabase(),
) {
  return {
    async listMainPage(
      principal: AdminPrincipal,
      filters: AdminConversationFilters,
      before?: AdminConversationListCursor,
    ): Promise<AdminConversationListPage> {
      if (before) {
        await assertListCursor(database, principal, filters, before);
      }
      const rows = await adminConversationQuery(database)
        .where(
          and(
            mainConversationConditions(principal, filters),
            before ? listBeforeCursor(before) : undefined,
          ),
        )
        .orderBy(desc(conversations.updatedAt), desc(conversations.id))
        .limit(CONVERSATION_LIST_PAGE_SIZE + 1);
      const hasMore = rows.length > CONVERSATION_LIST_PAGE_SIZE;
      const pageRows = hasMore
        ? rows.slice(0, CONVERSATION_LIST_PAGE_SIZE)
        : rows;
      const activeTurns = await readActiveTurns(
        database,
        pageRows.map((row) => row.conversation),
      );
      const items = pageRows.map((row) => ({
        ...toPublicConversation(
          row.conversation,
          row.conversation.activeTurnId
            ? activeTurns.get(row.conversation.activeTurnId)
            : undefined,
        ),
        owner: toAdminConversationOwner(row),
      }));
      const last = pageRows.at(-1)?.conversation;
      return {
        items,
        nextCursor:
          hasMore && last
            ? encodeAdminConversationListCursor({
                updatedAt: last.updatedAt.toISOString(),
                id: last.id,
                filterKey: adminConversationFilterKey(filters),
              })
            : null,
      };
    },
  };
}

export function adminConversationFilterKey(
  filters: AdminConversationFilters,
): string {
  return JSON.stringify([
    filters.ownerUserId ?? null,
    filters.ownerSource ?? null,
    filters.status ?? null,
    filters.archived,
  ]);
}

function mainConversationConditions(
  principal: AdminPrincipal,
  filters: AdminConversationFilters,
) {
  return and(
    eq(conversations.tenantId, principal.tenantId),
    eq(conversations.kind, "MAIN"),
    filters.ownerUserId
      ? eq(conversations.ownerUserId, filters.ownerUserId)
      : undefined,
    filters.ownerSource
      ? eq(conversations.ownerSource, filters.ownerSource)
      : undefined,
    filters.status ? eq(conversations.status, filters.status) : undefined,
    filters.archived === "active"
      ? isNull(conversations.archivedAt)
      : filters.archived === "archived"
        ? isNotNull(conversations.archivedAt)
        : undefined,
  );
}

async function assertListCursor(
  database: Database,
  principal: AdminPrincipal,
  filters: AdminConversationFilters,
  cursor: AdminConversationListCursor,
): Promise<void> {
  const [anchor] = await database
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        mainConversationConditions(principal, filters),
        eq(conversations.id, cursor.id),
        eq(conversations.updatedAt, new Date(cursor.updatedAt)),
      ),
    )
    .limit(1);
  if (!anchor) throw invalidConversationCursor();
}

function listBeforeCursor(cursor: AdminConversationListCursor) {
  const updatedAt = new Date(cursor.updatedAt);
  return or(
    lt(conversations.updatedAt, updatedAt),
    and(
      eq(conversations.updatedAt, updatedAt),
      lt(conversations.id, cursor.id),
    ),
  );
}
