import "server-only";

import { and, desc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { getDatabase, type Database } from "@/src/server/db/client";
import { conversations } from "@/src/server/db/schema";
import {
  encodeConversationListCursor,
  type ConversationListCursor,
} from "./conversation-cursors";
import { ownerScope, type OwnerPrincipal } from "./conversation-ownership";
import { invalidConversationCursor } from "./errors";
import {
  readActiveTurns,
  toPublicConversation,
} from "./public-conversation";
import {
  CONVERSATION_LIST_PAGE_SIZE,
  type PublicConversation,
} from "./types";

export type ConversationListItem = PublicConversation;

export type ConversationListPage = {
  readonly items: readonly ConversationListItem[];
  readonly nextCursor: string | null;
};

export function createConversationListingRepository(
  database: Database = getDatabase(),
) {
  return {
    async listMainPage(
      principal: OwnerPrincipal,
      input: {
        readonly archived: boolean;
        readonly before?: ConversationListCursor;
      },
    ): Promise<ConversationListPage> {
      if (input.before) {
        await assertListCursor(database, principal, input.archived, input.before);
      }
      const rows = await database
        .select()
        .from(conversations)
        .where(
          and(
            ownerScope(principal),
            eq(conversations.kind, "MAIN"),
            archivedFilter(input.archived),
            input.before ? listBeforeCursor(input.before) : undefined,
          ),
        )
        .orderBy(desc(conversations.updatedAt), desc(conversations.id))
        .limit(CONVERSATION_LIST_PAGE_SIZE + 1);
      const hasMore = rows.length > CONVERSATION_LIST_PAGE_SIZE;
      const pageRows = hasMore
        ? rows.slice(0, CONVERSATION_LIST_PAGE_SIZE)
        : rows;
      const activeTurns = await readActiveTurns(database, pageRows);
      const items = pageRows.map((conversation) =>
        toPublicConversation(
          conversation,
          conversation.activeTurnId
            ? activeTurns.get(conversation.activeTurnId)
            : undefined,
        ),
      );
      const last = pageRows.at(-1);
      return {
        items,
        nextCursor:
          hasMore && last
            ? encodeConversationListCursor({
                updatedAt: last.updatedAt.toISOString(),
                id: last.id,
              })
            : null,
      };
    },
  };
}

export type ConversationListingRepository = ReturnType<
  typeof createConversationListingRepository
>;

async function assertListCursor(
  database: Pick<Database, "select">,
  principal: OwnerPrincipal,
  archived: boolean,
  cursor: ConversationListCursor,
): Promise<void> {
  const [anchor] = await database
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        ownerScope(principal),
        eq(conversations.id, cursor.id),
        eq(conversations.kind, "MAIN"),
        archivedFilter(archived),
      ),
    )
    .limit(1);
  if (!anchor) throw invalidConversationCursor();
}

function archivedFilter(archived: boolean) {
  return archived
    ? isNotNull(conversations.archivedAt)
    : isNull(conversations.archivedAt);
}

function listBeforeCursor(cursor: ConversationListCursor) {
  const updatedAt = new Date(cursor.updatedAt);
  return or(
    lt(conversations.updatedAt, updatedAt),
    and(
      eq(conversations.updatedAt, updatedAt),
      lt(conversations.id, cursor.id),
    ),
  );
}
