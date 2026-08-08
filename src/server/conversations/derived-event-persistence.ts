import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { getDatabase, type Database } from "@/src/server/db/client";
import {
  conversationDerivedProjectionStates,
  conversations,
} from "@/src/server/db/schema";
import { operationalErrorMetadata } from "@/src/server/errors";
import { persistConversationActionAudit } from "./action-audit-repository";
import { conversationNotFound, conversationPersistenceFailure } from "./errors";
import type { ConversationEventPersistenceContext } from "./repository-types";
import { persistSubagentSecurityAudit } from "./subagent-linking";
import { persistConversationUiState } from "./ui-state-repository";
import { persistConversationStepUsage } from "./usage-repository";

export type DerivedEventPersistence = (
  context: ConversationEventPersistenceContext,
) => Promise<void>;

export async function applyDerivedConversationEvent(input: {
  readonly database?: Database;
  readonly conversationId: string;
  readonly cursor: bigint;
  readonly event: HandleMessageStreamEvent;
  readonly eventAt: Date;
  readonly persist?: DerivedEventPersistence;
}): Promise<"applied" | "already_applied" | "gap"> {
  const database = input.database ?? getDatabase();
  const persist = input.persist ?? persistDerivedEventChanges;
  return database.transaction(async (transaction) => {
    const [conversation] = await transaction
      .select()
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1);
    if (!conversation) throw conversationNotFound();

    await transaction
      .insert(conversationDerivedProjectionStates)
      .values({
        conversationId: conversation.id,
        tenantId: conversation.tenantId,
        updatedAt: input.eventAt,
      })
      .onConflictDoNothing();
    const [state] = await transaction
      .select()
      .from(conversationDerivedProjectionStates)
      .where(
        eq(
          conversationDerivedProjectionStates.conversationId,
          conversation.id,
        ),
      )
      .limit(1)
      .for("update");
    if (!state || state.tenantId !== conversation.tenantId) {
      throw conversationPersistenceFailure();
    }
    if (state.lastEveCursor !== null && state.lastEveCursor >= input.cursor) {
      return "already_applied";
    }
    const expectedCursor =
      state.lastEveCursor === null ? 0n : state.lastEveCursor + 1n;
    if (input.cursor !== expectedCursor) return "gap";

    await persist({
      transaction,
      conversation,
      cursor: input.cursor,
      event: input.event,
      eventAt: input.eventAt,
    });
    const [updated] = await transaction
      .update(conversationDerivedProjectionStates)
      .set({
        lastEveCursor: input.cursor,
        failureCount: 0,
        lastFailureCode: null,
        lastFailureAt: null,
        updatedAt: input.eventAt,
      })
      .where(
        and(
          eq(
            conversationDerivedProjectionStates.conversationId,
            conversation.id,
          ),
          state.lastEveCursor === null
            ? sql`${conversationDerivedProjectionStates.lastEveCursor} IS NULL`
            : eq(
                conversationDerivedProjectionStates.lastEveCursor,
                state.lastEveCursor,
              ),
        ),
      )
      .returning({
        conversationId: conversationDerivedProjectionStates.conversationId,
      });
    if (!updated) throw conversationPersistenceFailure();
    return "applied";
  });
}

export async function recordDerivedProjectionFailure(input: {
  readonly database?: Database;
  readonly conversationId: string;
  readonly error: unknown;
  readonly failedAt: Date;
}): Promise<void> {
  const database = input.database ?? getDatabase();
  const metadata = operationalErrorMetadata(input.error);
  await database.transaction(async (transaction) => {
    const [conversation] = await transaction
      .select({ tenantId: conversations.tenantId })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1);
    if (!conversation) return;
    await transaction
      .insert(conversationDerivedProjectionStates)
      .values({
        conversationId: input.conversationId,
        tenantId: conversation.tenantId,
        failureCount: 1,
        lastFailureCode: metadata.errorCode,
        lastFailureAt: input.failedAt,
        updatedAt: input.failedAt,
      })
      .onConflictDoUpdate({
        target: conversationDerivedProjectionStates.conversationId,
        set: {
          failureCount: sql`${conversationDerivedProjectionStates.failureCount} + 1`,
          lastFailureCode: metadata.errorCode,
          lastFailureAt: input.failedAt,
          updatedAt: input.failedAt,
        },
      });
  });
}

async function persistDerivedEventChanges(
  context: ConversationEventPersistenceContext,
): Promise<void> {
  await persistConversationStepUsage(context);
  await persistConversationActionAudit(context);
  await persistConversationUiState(context);
  await persistSubagentSecurityAudit(context);
}
