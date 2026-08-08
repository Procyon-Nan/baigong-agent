import "server-only";

import { eq } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { getDatabase, type Database } from "@/src/server/db/client";
import { conversations } from "@/src/server/db/schema";
import { operationalErrorMetadata } from "@/src/server/errors";
import {
  applyDerivedConversationEvent,
  type DerivedEventPersistence,
  recordDerivedProjectionFailure,
} from "./derived-event-persistence";
import { conversationNotFound, conversationPersistenceFailure } from "./errors";
import {
  persistConversationHistoryEvent,
  recordConversationEventReceipt,
} from "./history-repository";
import { applyLifecycleEvent } from "./lifecycle-repository";
import type { ConversationEventPersistenceContext } from "./repository-types";
import { persistSubagentLinking } from "./subagent-linking";

export type ConversationEventPersistence = ReturnType<
  typeof createConversationEventPersistence
>;

export function createConversationEventPersistence(
  database: Database = getDatabase(),
  options: { readonly persistDerived?: DerivedEventPersistence } = {},
) {
  return {
    async applyEvent(
      conversationId: string,
      cursor: number,
      event: HandleMessageStreamEvent,
    ): Promise<boolean> {
      const durableCursor = parseDurableCursor(cursor);
      const eventAt = eventDate(event);
      const coreApplied = await database.transaction(async (transaction) => {
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
      try {
        await applyDerivedConversationEvent({
          database,
          conversationId,
          cursor: durableCursor,
          event,
          eventAt,
          persist: options.persistDerived,
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "conversation_derived_projection_failed",
            conversationId,
            eveCursor: cursor,
            eveEventType: event.type,
            ...operationalErrorMetadata(error),
          }),
        );
        try {
          await recordDerivedProjectionFailure({
            database,
            conversationId,
            error,
            failedAt: eventAt,
          });
        } catch (recordingError) {
          console.error(
            JSON.stringify({
              level: "error",
              event: "conversation_derived_projection_failure_record_failed",
              conversationId,
              eveCursor: cursor,
              eveEventType: event.type,
              ...operationalErrorMetadata(recordingError),
            }),
          );
        }
      }
      return coreApplied;
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
