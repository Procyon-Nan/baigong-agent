import { and, eq, inArray } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import type { Database } from "@/src/server/db/client";
import {
  conversationTurns,
  conversations,
} from "@/src/server/db/schema";
import { encryptContinuationToken } from "@/src/server/models/credentials";
import { conversationPersistenceFailure } from "./errors";

type ConversationTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export async function applyLifecycleEvent(
  transaction: ConversationTransaction,
  conversation: typeof conversations.$inferSelect,
  event: HandleMessageStreamEvent,
): Promise<void> {
  const now = eventDate(event);
  switch (event.type) {
    case "turn.started": {
      if (!conversation.activeTurnId) return;
      const [updated] = await transaction
        .update(conversationTurns)
        .set({
          eveTurnId: event.data.turnId,
          status:
            conversation.status === "CANCELLING" ? "CANCELLING" : "RUNNING",
          startedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(conversationTurns.id, conversation.activeTurnId),
            inArray(conversationTurns.status, [
              "SUBMITTING",
              "RUNNING",
              "CANCELLING",
            ]),
          ),
        )
        .returning({ id: conversationTurns.id });
      if (!updated) throw conversationPersistenceFailure();
      return;
    }
    case "turn.completed":
      await settleTurn(
        transaction,
        conversation,
        event.data.turnId,
        "COMPLETED",
        null,
        now,
      );
      return;
    case "turn.failed":
      await settleTurn(
        transaction,
        conversation,
        event.data.turnId,
        "FAILED",
        "MODEL_UNAVAILABLE",
        now,
      );
      return;
    case "turn.cancelled":
      await settleTurn(
        transaction,
        conversation,
        event.data.turnId,
        "CANCELLED",
        null,
        now,
      );
      return;
    case "session.waiting": {
      const revision = conversation.continuationTokenRevision + 1;
      const encrypted = await encryptContinuationToken(
        event.data.continuationToken,
        {
          tenantId: conversation.tenantId,
          conversationId: conversation.id,
          revision,
        },
      );
      await transaction
        .update(conversations)
        .set({
          encryptedContinuationToken: encrypted,
          continuationTokenRevision: revision,
          status: "WAITING",
          activeTurnId: null,
          updatedAt: now,
        })
        .where(eq(conversations.id, conversation.id));
      return;
    }
    case "session.failed":
      if (conversation.activeTurnId) {
        await transaction
          .update(conversationTurns)
          .set({
            status: "FAILED",
            publicErrorCode: "CONVERSATION_UNAVAILABLE",
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(conversationTurns.id, conversation.activeTurnId));
      }
      await transaction
        .update(conversations)
        .set({ status: "TERMINAL_FAILED", activeTurnId: null, updatedAt: now })
        .where(eq(conversations.id, conversation.id));
      return;
    case "session.completed":
      if (conversation.activeTurnId) {
        await transaction
          .update(conversationTurns)
          .set({ status: "COMPLETED", completedAt: now, updatedAt: now })
          .where(eq(conversationTurns.id, conversation.activeTurnId));
      }
      await transaction
        .update(conversations)
        .set({
          status: "TERMINAL_COMPLETED",
          activeTurnId: null,
          updatedAt: now,
        })
        .where(eq(conversations.id, conversation.id));
      return;
    default:
      return;
  }
}

export function eventDate(event: HandleMessageStreamEvent): Date {
  const parsed = event.meta?.at ? new Date(event.meta.at) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

async function settleTurn(
  transaction: ConversationTransaction,
  conversation: typeof conversations.$inferSelect,
  eveTurnId: string,
  status: "COMPLETED" | "FAILED" | "CANCELLED",
  publicErrorCode: string | null,
  now: Date,
): Promise<void> {
  if (!conversation.activeTurnId) return;
  const [updated] = await transaction
    .update(conversationTurns)
    .set({ status, publicErrorCode, completedAt: now, updatedAt: now })
    .where(
      and(
        eq(conversationTurns.id, conversation.activeTurnId),
        eq(conversationTurns.eveTurnId, eveTurnId),
      ),
    )
    .returning({ id: conversationTurns.id });
  if (!updated) throw conversationPersistenceFailure();
}
