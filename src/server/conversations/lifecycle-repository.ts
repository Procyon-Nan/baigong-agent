import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { conversationTurns, conversations } from "@/src/server/db/schema";
import { encryptContinuationToken } from "@/src/server/models/credentials";
import { conversationPersistenceFailure } from "./errors";
import type { ConversationTransaction } from "./repository-types";

const ACTIVE_TURN_STATUSES: ReadonlySet<
  typeof conversationTurns.$inferSelect.status
> = new Set(["SUBMITTING", "RUNNING", "CANCELLING"]);

export async function applyLifecycleEvent(
  transaction: ConversationTransaction,
  conversation: typeof conversations.$inferSelect,
  event: HandleMessageStreamEvent,
  eventAt: Date,
): Promise<void> {
  const now = eventAt;
  switch (event.type) {
    case "turn.started": {
      await mapStartedTurn(transaction, conversation, event.data.turnId, now);
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
      const activeTurn = conversation.activeTurnId
        ? await findTurnStatus(transaction, conversation.activeTurnId)
        : null;
      if (conversation.activeTurnId && !activeTurn) {
        throw conversationPersistenceFailure();
      }
      const keepActiveTurn =
        activeTurn !== null && ACTIVE_TURN_STATUSES.has(activeTurn.status);
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
          ...(keepActiveTurn
            ? {}
            : { status: "WAITING" as const, activeTurnId: null }),
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

async function settleTurn(
  transaction: ConversationTransaction,
  conversation: typeof conversations.$inferSelect,
  eveTurnId: string,
  status: "COMPLETED" | "FAILED" | "CANCELLED",
  publicErrorCode: string | null,
  now: Date,
): Promise<void> {
  const [updated] = await transaction
    .update(conversationTurns)
    .set({ status, publicErrorCode, completedAt: now, updatedAt: now })
    .where(
      and(
        eq(conversationTurns.conversationId, conversation.id),
        eq(conversationTurns.eveTurnId, eveTurnId),
      ),
    )
    .returning({ id: conversationTurns.id });
  if (!updated) throw conversationPersistenceFailure();
}

async function mapStartedTurn(
  transaction: ConversationTransaction,
  conversation: typeof conversations.$inferSelect,
  eveTurnId: string,
  now: Date,
): Promise<void> {
  const [existing] = await transaction
    .select({ id: conversationTurns.id })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.conversationId, conversation.id),
        eq(conversationTurns.eveTurnId, eveTurnId),
      ),
    )
    .limit(1);
  if (existing) return;

  const [candidate] = await transaction
    .select({ id: conversationTurns.id, status: conversationTurns.status })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.conversationId, conversation.id),
        isNull(conversationTurns.eveTurnId),
        lte(conversationTurns.createdAt, now),
      ),
    )
    .orderBy(desc(conversationTurns.createdAt))
    .limit(1)
    .for("update");
  if (!candidate) throw conversationPersistenceFailure();

  const active = candidate.id === conversation.activeTurnId;
  const [updated] = await transaction
    .update(conversationTurns)
    .set({
      eveTurnId,
      ...(active && ACTIVE_TURN_STATUSES.has(candidate.status)
        ? {
            status:
              conversation.status === "CANCELLING"
                ? ("CANCELLING" as const)
                : ("RUNNING" as const),
          }
        : {}),
      startedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversationTurns.id, candidate.id),
        isNull(conversationTurns.eveTurnId),
      ),
    )
    .returning({ id: conversationTurns.id });
  if (!updated) throw conversationPersistenceFailure();
}

async function findTurnStatus(
  transaction: ConversationTransaction,
  turnId: string,
): Promise<{
  readonly status: typeof conversationTurns.$inferSelect.status;
} | null> {
  const [turn] = await transaction
    .select({ status: conversationTurns.status })
    .from(conversationTurns)
    .where(eq(conversationTurns.id, turnId))
    .limit(1);
  return turn ?? null;
}
