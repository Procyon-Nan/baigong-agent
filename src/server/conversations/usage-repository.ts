import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import {
  conversationStepUsages,
  conversationTurns,
  modelConfigVersions,
} from "@/src/server/db/schema";
import { getDatabase, type Database } from "@/src/server/db/client";
import { conversationPersistenceFailure } from "./errors";
import type {
  ConversationEventPersistenceContext,
  ConversationTransaction,
} from "./repository-types";
import { findConversationTurnByEveId } from "./turn-repository";

export type TokenUsageTotals = {
  readonly stepCount: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly costUsd: number | null;
};

export type ConversationUsageSummary = {
  readonly direct: TokenUsageTotals;
  readonly subagents: TokenUsageTotals;
  readonly total: TokenUsageTotals;
  readonly currentContext: {
    readonly inputTokens: number | null;
    readonly contextWindowTokens: number | null;
  };
};

type UsageRow = {
  readonly direct: boolean;
  readonly usageId: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly costUsd: number | null;
};

type PersistedUsageRow = Omit<UsageRow, "direct" | "usageId">;

export async function persistConversationStepUsage(
  context: ConversationEventPersistenceContext,
): Promise<void> {
  if (context.event.type !== "step.completed") return;
  const turn = await findConversationTurnByEveId(
    context.transaction,
    context.conversation.id,
    context.event.data.turnId,
  );
  if (!turn) throw conversationPersistenceFailure();

  const usage = context.event.data.usage;
  await context.transaction.insert(conversationStepUsages).values({
    tenantId: context.conversation.tenantId,
    conversationId: context.conversation.id,
    turnId: turn.id,
    eveTurnId: context.event.data.turnId,
    stepIndex: context.event.data.stepIndex,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null,
    cacheWriteTokens: usage?.cacheWriteTokens ?? null,
    costUsd: usage?.costUsd ?? null,
    eveCursor: context.cursor,
    eventAt: context.eventAt,
  });
}

export function createConversationUsageRepository(
  database: Database = getDatabase(),
) {
  return {
    getSummary(
      tenantId: string,
      conversationId: string,
    ): Promise<ConversationUsageSummary | null> {
      return database.transaction(
        async (transaction) => {
          const usageRows = await readUsageTree(
            transaction,
            tenantId,
            conversationId,
          );
          if (usageRows.length === 0) return null;

          const persistedRows = usageRows.filter(
            (row): row is UsageRow & { readonly usageId: string } =>
              row.usageId !== null,
          );
          const directRows = persistedRows.filter((row) => row.direct);
          const subagentRows = persistedRows.filter((row) => !row.direct);
          const currentContext = await readCurrentContext(
            transaction,
            tenantId,
            conversationId,
          );
          return {
            direct: aggregateUsage(directRows),
            subagents: aggregateUsage(subagentRows),
            total: aggregateUsage(persistedRows),
            currentContext,
          };
        },
        { accessMode: "read only", isolationLevel: "repeatable read" },
      );
    },
  };
}

async function readUsageTree(
  transaction: ConversationTransaction,
  tenantId: string,
  conversationId: string,
): Promise<UsageRow[]> {
  const result = await transaction.execute<UsageRow>(sql`
    WITH RECURSIVE conversation_tree(id) AS (
      SELECT id
      FROM conversations
      WHERE tenant_id = ${tenantId}::uuid
        AND id = ${conversationId}::uuid

      UNION

      SELECT child.id
      FROM conversations AS child
      INNER JOIN conversation_tree AS parent
        ON child.parent_conversation_id = parent.id
      WHERE child.tenant_id = ${tenantId}::uuid
        AND child.kind = 'SUBAGENT'
        AND child.link_status = 'VERIFIED'
    )
    SELECT
      conversation_tree.id = ${conversationId}::uuid AS "direct",
      usage.id AS "usageId",
      usage.input_tokens AS "inputTokens",
      usage.output_tokens AS "outputTokens",
      usage.cache_read_tokens AS "cacheReadTokens",
      usage.cache_write_tokens AS "cacheWriteTokens",
      usage.cost_usd::double precision AS "costUsd"
    FROM conversation_tree
    LEFT JOIN conversation_step_usages AS usage
      ON usage.conversation_id = conversation_tree.id
      AND usage.tenant_id = ${tenantId}::uuid
  `);
  return result.rows;
}

async function readCurrentContext(
  transaction: ConversationTransaction,
  tenantId: string,
  conversationId: string,
): Promise<ConversationUsageSummary["currentContext"]> {
  const [latest] = await transaction
    .select({
      inputTokens: conversationStepUsages.inputTokens,
      contextWindowTokens: modelConfigVersions.contextWindowTokens,
    })
    .from(conversationStepUsages)
    .innerJoin(
      conversationTurns,
      and(
        eq(conversationTurns.tenantId, conversationStepUsages.tenantId),
        eq(
          conversationTurns.conversationId,
          conversationStepUsages.conversationId,
        ),
        eq(conversationTurns.id, conversationStepUsages.turnId),
      ),
    )
    .innerJoin(
      modelConfigVersions,
      and(
        eq(modelConfigVersions.tenantId, conversationTurns.tenantId),
        eq(modelConfigVersions.id, conversationTurns.modelConfigVersionId),
      ),
    )
    .where(
      and(
        eq(conversationStepUsages.tenantId, tenantId),
        eq(conversationStepUsages.conversationId, conversationId),
      ),
    )
    .orderBy(
      desc(conversationStepUsages.eveCursor),
      desc(conversationStepUsages.stepIndex),
    )
    .limit(1);
  return {
    inputTokens: latest?.inputTokens ?? null,
    contextWindowTokens: latest?.contextWindowTokens ?? null,
  };
}

function aggregateUsage(rows: readonly PersistedUsageRow[]): TokenUsageTotals {
  if (rows.length === 0) {
    return {
      stepCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: null,
    };
  }
  const inputTokens = sumCompleteIntegers(rows, "inputTokens");
  const outputTokens = sumCompleteIntegers(rows, "outputTokens");
  return {
    stepCount: rows.length,
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens === null || outputTokens === null
        ? null
        : safeIntegerSum([inputTokens, outputTokens]),
    cacheReadTokens: sumCompleteIntegers(rows, "cacheReadTokens"),
    cacheWriteTokens: sumCompleteIntegers(rows, "cacheWriteTokens"),
    costUsd: sumCompleteCosts(rows),
  };
}

function sumCompleteIntegers(
  rows: readonly PersistedUsageRow[],
  field:
    | "inputTokens"
    | "outputTokens"
    | "cacheReadTokens"
    | "cacheWriteTokens",
): number | null {
  if (rows.length === 0) return null;
  const values: number[] = [];
  for (const row of rows) {
    const value = row[field];
    if (value === null) return null;
    values.push(value);
  }
  return safeIntegerSum(values);
}

function safeIntegerSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) throw conversationPersistenceFailure();
  }
  return total;
}

function sumCompleteCosts(rows: readonly PersistedUsageRow[]): number | null {
  if (rows.length === 0) return null;
  const scaled: number[] = [];
  for (const { costUsd } of rows) {
    if (costUsd === null) return null;
    scaled.push(Math.round(costUsd * 100_000_000));
  }
  return safeIntegerSum(scaled) / 100_000_000;
}
