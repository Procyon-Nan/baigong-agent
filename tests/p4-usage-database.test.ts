import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDatabase } from "@/src/server/db/client";
import {
  conversationStepUsages,
  conversationTurns,
  conversations,
} from "@/src/server/db/schema";
import type { ReservedConversationTurn } from "@/src/server/conversations/types";
import {
  configureP4Model,
  prepareP4Conversation,
} from "./support/p4-conversation-fixtures";
import {
  cleanupP4TestContext,
  cleanupP4TestDataDirectories,
  configureP4TestDatabase,
  createP4TestContext,
  migrateP4TestDatabase,
  type P4TestContext,
} from "./support/p4-test-database";

configureP4TestDatabase();

const contexts: P4TestContext[] = [];

describe("P4 usage persistence", () => {
  beforeAll(async () => {
    await migrateP4TestDatabase();
  });

  afterAll(async () => {
    try {
      for (const context of contexts.reverse()) {
        await cleanupP4TestContext(context);
      }
    } finally {
      const { closeDatabase } = await import("@/src/server/db/client");
      await closeDatabase();
      await cleanupP4TestDataDirectories();
    }
  });

  it("persists step usage and aggregates verified descendants once", async () => {
    const context = await testContext("usage-tree");
    const { repository, reservation } = await prepareP4Conversation(
      context,
      "usage root",
    );
    const conversationId = reservation.conversationId;
    const child = await insertSubagent(
      context,
      reservation,
      "VERIFIED",
      "child",
    );
    const grandchild = await insertSubagent(
      context,
      child.turn,
      "VERIFIED",
      "grandchild",
    );
    const unverified = await insertSubagent(
      context,
      reservation,
      "PENDING",
      "unverified",
    );

    await repository.applyEvent(
      conversationId,
      0,
      turnEvent("turn.started", "root-eve-turn"),
    );
    await repository.applyEvent(
      conversationId,
      1,
      stepCompletedEvent("root-eve-turn", 0, {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        costUsd: 0.1,
      }),
    );
    await repository.applyEvent(
      conversationId,
      2,
      stepCompletedEvent("root-eve-turn", 1, {
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 20,
        cacheWriteTokens: 0,
        costUsd: 0.2,
      }),
    );
    await repository.applyEvent(
      child.conversationId,
      0,
      stepCompletedEvent(child.eveTurnId, 0, {
        inputTokens: 40,
        outputTokens: 10,
        cacheReadTokens: 3,
        cacheWriteTokens: 0,
        costUsd: 0.04,
      }),
    );
    await repository.applyEvent(
      grandchild.conversationId,
      0,
      stepCompletedEvent(grandchild.eveTurnId, 0, {
        inputTokens: 20,
        outputTokens: 5,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        costUsd: 0.02,
      }),
    );
    await repository.applyEvent(
      unverified.conversationId,
      0,
      stepCompletedEvent(unverified.eveTurnId, 0, {
        inputTokens: 999,
        outputTokens: 999,
      }),
    );
    await configureP4Model(context, 65_536);

    const { createConversationUsageRepository } = await import(
      "@/src/server/conversations/usage-repository"
    );
    const summary = await createConversationUsageRepository().getSummary(
      context.tenantId,
      conversationId,
    );
    expect(summary).toEqual({
      direct: {
        stepCount: 2,
        inputTokens: 220,
        outputTokens: 50,
        totalTokens: 270,
        cacheReadTokens: 30,
        cacheWriteTokens: 5,
        costUsd: 0.3,
      },
      subagents: {
        stepCount: 2,
        inputTokens: 60,
        outputTokens: 15,
        totalTokens: 75,
        cacheReadTokens: 5,
        cacheWriteTokens: 1,
        costUsd: 0.06,
      },
      total: {
        stepCount: 4,
        inputTokens: 280,
        outputTokens: 65,
        totalTokens: 345,
        cacheReadTokens: 35,
        cacheWriteTokens: 6,
        costUsd: 0.36,
      },
      currentContext: {
        inputTokens: 120,
        contextWindowTokens: 8_192,
      },
    });

    const usageRows = await getDatabase()
      .select()
      .from(conversationStepUsages)
      .where(eq(conversationStepUsages.conversationId, conversationId));
    expect(usageRows).toHaveLength(2);
  }, 30_000);

  it("keeps missing provider usage fields unknown instead of treating them as zero", async () => {
    const context = await testContext("usage-missing");
    const { repository, reservation } = await prepareP4Conversation(
      context,
      "missing usage",
    );
    await repository.applyEvent(
      reservation.conversationId,
      0,
      turnEvent("turn.started", "missing-eve-turn"),
    );
    await repository.applyEvent(
      reservation.conversationId,
      1,
      stepCompletedEvent("missing-eve-turn", 0, { inputTokens: 12 }),
    );
    await repository.applyEvent(
      reservation.conversationId,
      2,
      stepCompletedEvent("missing-eve-turn", 1),
    );

    const { createConversationUsageRepository } = await import(
      "@/src/server/conversations/usage-repository"
    );
    const summary = await createConversationUsageRepository().getSummary(
      context.tenantId,
      reservation.conversationId,
    );
    expect(summary).toMatchObject({
      direct: {
        stepCount: 2,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        costUsd: null,
      },
      subagents: {
        stepCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      currentContext: {
        inputTokens: null,
        contextWindowTokens: 8_192,
      },
    });
    await expect(
      createConversationUsageRepository().getSummary(
        randomUUID(),
        reservation.conversationId,
      ),
    ).resolves.toBeNull();
  }, 30_000);
});

type SubagentParent = Pick<
  ReservedConversationTurn,
  "conversationId" | "turnId" | "modelConfigVersionId"
>;

async function testContext(label: string): Promise<P4TestContext> {
  const context = await createP4TestContext(label);
  contexts.push(context);
  return context;
}

async function insertSubagent(
  context: P4TestContext,
  parent: SubagentParent,
  linkStatus: "PENDING" | "VERIFIED",
  label: string,
): Promise<{
  readonly conversationId: string;
  readonly eveTurnId: string;
  readonly turn: SubagentParent;
}> {
  const conversationId = randomUUID();
  const turnId = randomUUID();
  const eveTurnId = `eve-${label}-${randomUUID()}`;
  const now = new Date();
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    await transaction.insert(conversations).values({
      id: conversationId,
      tenantId: context.tenantId,
      ownerUserId: context.administrator.userId,
      ownerSource: context.administrator.source,
      kind: "SUBAGENT",
      title: label,
      parentConversationId: parent.conversationId,
      parentTurnId: parent.turnId,
      delegationCallId: `call-${label}-${randomUUID()}`,
      subagentName: label,
      linkStatus,
      agentId: `agent-${label}`,
      status: "WAITING",
      nextMessageSequence: 0,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(conversationTurns).values({
      id: turnId,
      tenantId: context.tenantId,
      conversationId,
      ownerUserId: context.administrator.userId,
      requestId: randomUUID(),
      eveTurnId,
      modelConfigVersionId: parent.modelConfigVersionId,
      status: "COMPLETED",
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
  return {
    conversationId,
    eveTurnId,
    turn: {
      conversationId,
      turnId,
      modelConfigVersionId: parent.modelConfigVersionId,
    },
  };
}

function turnEvent(
  type: "turn.started",
  turnId: string,
): HandleMessageStreamEvent {
  return event(type, { turnId, sequence: 1 });
}

function stepCompletedEvent(
  turnId: string,
  stepIndex: number,
  usage?: Record<string, number>,
): HandleMessageStreamEvent {
  return event("step.completed", {
    turnId,
    stepIndex,
    sequence: 1,
    finishReason: "stop",
    ...(usage ? { usage } : {}),
  });
}

function event(
  type: HandleMessageStreamEvent["type"],
  data: Record<string, unknown>,
): HandleMessageStreamEvent {
  return {
    type,
    data,
    meta: { at: new Date().toISOString() },
  } as HandleMessageStreamEvent;
}
