import "server-only";

import { eq } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { getDatabase, type Database } from "@/src/server/db/client";
import { conversations } from "@/src/server/db/schema";
import { persistConversationActionAudit } from "./action-audit-repository";
import { conversationNotFound, conversationPersistenceFailure } from "./errors";
import {
  persistConversationHistoryEvent,
  recordConversationEventReceipt,
} from "./history-repository";
import { applyLifecycleEvent } from "./lifecycle-repository";
import type { ConversationEventPersistenceContext } from "./repository-types";
import { persistSubagentLinking } from "./subagent-linking";
import { persistConversationStepUsage } from "./usage-repository";

export type ConversationEventPersistence = ReturnType<
  typeof createConversationEventPersistence
>;

export function createConversationEventPersistence(
  database: Database = getDatabase(),
) {
  return {
    async applyEvent(
      conversationId: string,
      cursor: number,
      event: HandleMessageStreamEvent,
    ): Promise<boolean> {
      const durableCursor = parseDurableCursor(cursor);
      return database.transaction(async (transaction) => {
        const [conversation] = await transaction
          .select()
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .limit(1)
          .for("update");
        if (!conversation) throw conversationNotFound();
        if (
          conversation.lastEveCursor !== null &&
          conversation.lastEveCursor >= durableCursor
        ) {
          return false;
        }

        const expectedCursor =
          conversation.lastEveCursor === null
            ? 0n
            : conversation.lastEveCursor + 1n;
        if (durableCursor !== expectedCursor) {
          throw conversationPersistenceFailure();
        }

        const eventAt = eventDate(event);
        const receiptRecorded = await recordConversationEventReceipt(
          transaction,
          {
            tenantId: conversation.tenantId,
            conversationId,
            eveCursor: durableCursor,
            eventType: event.type,
            eventAt,
          },
        );
        if (!receiptRecorded) throw conversationPersistenceFailure();

        await persistConversationEventChanges({
          transaction,
          conversation,
          cursor: durableCursor,
          event,
          eventAt,
        });
        const [updated] = await transaction
          .update(conversations)
          .set({ lastEveCursor: durableCursor, updatedAt: eventAt })
          .where(eq(conversations.id, conversationId))
          .returning({ id: conversations.id });
        if (!updated) throw conversationPersistenceFailure();
        return true;
      });
    },
  };
}

async function persistConversationEventChanges(
  context: ConversationEventPersistenceContext,
): Promise<void> {
  await applyLifecycleEvent(
    context.transaction,
    context.conversation,
    context.event,
    context.eventAt,
  );
  await persistConversationHistoryEvent(context);
  await persistConversationStepUsage(context);
  await persistConversationActionAudit(context);
  await persistSubagentLinking(context);
}

function parseDurableCursor(cursor: number): bigint {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw conversationPersistenceFailure();
  }
  return BigInt(cursor);
}

function eventDate(event: HandleMessageStreamEvent): Date {
  const parsed = event.meta?.at ? new Date(event.meta.at) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}
