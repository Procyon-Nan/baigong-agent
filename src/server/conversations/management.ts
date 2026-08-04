import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { getDatabase, type Database } from "@/src/server/db/client";
import { conversations, type ConversationStatus } from "@/src/server/db/schema";
import {
  findOwnedMainConversation,
  lockConversationOwner,
  ownerScope,
  type OwnerPrincipal,
} from "./conversation-ownership";
import {
  conversationBusy,
  conversationNotFound,
  conversationPersistenceFailure,
} from "./errors";
import { assertMainConversationQuota } from "./limits";
import { readActiveTurn, toPublicConversation } from "./public-conversation";
import type { PublicConversation } from "./types";

const ACTIVE_CONVERSATION_STATUSES: ReadonlySet<ConversationStatus> = new Set([
  "STARTING",
  "RUNNING",
  "CANCELLING",
]);

export function createConversationManagementRepository(
  database: Database = getDatabase(),
) {
  return {
    rename(
      principal: OwnerPrincipal,
      conversationId: string,
      title: string,
    ): Promise<PublicConversation> {
      return updateMainConversation(database, principal, conversationId, {
        title,
      });
    },

    archive(
      principal: OwnerPrincipal,
      conversationId: string,
    ): Promise<PublicConversation> {
      return updateMainConversation(database, principal, conversationId, {
        archivedAt: new Date(),
      });
    },

    restore(
      principal: OwnerPrincipal,
      conversationId: string,
    ): Promise<PublicConversation> {
      return database.transaction(async (transaction) => {
        await lockConversationOwner(transaction, principal);
        const conversation = await findOwnedMainConversation(
          transaction,
          principal,
          conversationId,
        );
        if (!conversation) throw conversationNotFound();
        if (conversation.archivedAt === null) {
          const activeTurn = conversation.activeTurnId
            ? await readActiveTurn(transaction, conversation.activeTurnId)
            : undefined;
          return toPublicConversation(conversation, activeTurn);
        }
        await assertMainConversationQuota(transaction, principal);
        const [updated] = await transaction
          .update(conversations)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(
            and(
              ownerScope(principal),
              eq(conversations.id, conversationId),
              eq(conversations.kind, "MAIN"),
              isNotNull(conversations.archivedAt),
            ),
          )
          .returning();
        if (!updated) throw conversationPersistenceFailure();
        return toPublicConversation(updated);
      });
    },
  };
}

export type ConversationManagementRepository = ReturnType<
  typeof createConversationManagementRepository
>;

async function updateMainConversation(
  database: Database,
  principal: OwnerPrincipal,
  conversationId: string,
  update: {
    readonly title?: string;
    readonly archivedAt?: Date;
  },
): Promise<PublicConversation> {
  return database.transaction(async (transaction) => {
    await lockConversationOwner(transaction, principal);
    const conversation = await findOwnedMainConversation(
      transaction,
      principal,
      conversationId,
    );
    if (!conversation) throw conversationNotFound();
    if (
      update.archivedAt !== undefined &&
      ACTIVE_CONVERSATION_STATUSES.has(conversation.status)
    ) {
      throw conversationBusy();
    }
    const [updated] = await transaction
      .update(conversations)
      .set({ ...update, updatedAt: new Date() })
      .where(
        and(
          ownerScope(principal),
          eq(conversations.id, conversationId),
          eq(conversations.kind, "MAIN"),
        ),
      )
      .returning();
    if (!updated) throw conversationPersistenceFailure();
    return toPublicConversation(updated);
  });
}
