import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDatabase } from "@/src/server/db/client";
import {
  conversationActionAudits,
  conversationEventReceipts,
  conversations,
} from "@/src/server/db/schema";
import { prepareP4Conversation } from "./support/p4-conversation-fixtures";
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

describe("P4 action audit persistence", () => {
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

  it("indexes action lifecycles without storing request or result payloads", async () => {
    const context = await testContext("action-lifecycle");
    const { repository, reservation } = await prepareP4Conversation(
      context,
      "action audit",
    );
    const conversationId = reservation.conversationId;
    const eveTurnId = "action-eve-turn";

    await repository.applyEvent(
      conversationId,
      0,
      turnStartedEvent(eveTurnId),
    );
    await repository.applyEvent(
      conversationId,
      1,
      actionsRequestedEvent(eveTurnId),
    );
    await repository.applyEvent(
      conversationId,
      2,
      actionResultEvent(eveTurnId, {
        callId: "call-tool",
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call-tool",
          toolName: "search_docs",
          output: { secret: "must-not-be-stored" },
        },
      }),
    );
    await repository.applyEvent(
      conversationId,
      3,
      actionResultEvent(eveTurnId, {
        callId: "call-skill",
        status: "failed",
        errorCode: "provider/key leaked in code",
        result: {
          kind: "load-skill-result",
          callId: "call-skill",
          name: "review",
          isError: true,
          output: "sensitive failure detail",
        },
      }),
    );
    await repository.applyEvent(
      conversationId,
      4,
      actionResultEvent(eveTurnId, {
        callId: "call-subagent",
        status: "rejected",
        result: {
          kind: "subagent-result",
          callId: "call-subagent",
          subagentName: "researcher",
          output: "denied",
        },
      }),
    );

    const { createConversationActionAuditRepository } = await import(
      "@/src/server/conversations/action-audit-repository"
    );
    const page = await createConversationActionAuditRepository().listPage(
      context.tenantId,
      conversationId,
      { limit: 10 },
    );
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(4);
    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "REMOTE_AGENT",
          actionName: "remote-researcher",
          status: "PENDING",
          rawDetails: { available: true, startIndex: 1, endIndex: null },
        }),
        expect.objectContaining({
          actionType: "SUBAGENT",
          actionName: "researcher",
          status: "REJECTED",
          errorCode: null,
          rawDetails: { available: true, startIndex: 1, endIndex: 4 },
        }),
        expect.objectContaining({
          actionType: "SKILL",
          actionName: "review",
          status: "FAILED",
          errorCode: "ACTION_FAILED",
          rawDetails: { available: true, startIndex: 1, endIndex: 3 },
        }),
        expect.objectContaining({
          actionType: "TOOL",
          actionName: "search_docs",
          status: "COMPLETED",
          errorCode: null,
          rawDetails: { available: true, startIndex: 1, endIndex: 2 },
        }),
      ]),
    );

    const stored = JSON.stringify(
      await getDatabase()
        .select()
        .from(conversationActionAudits)
        .where(eq(conversationActionAudits.conversationId, conversationId)),
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
    );
    expect(stored).not.toContain("must-not-be-stored");
    expect(stored).not.toContain("sensitive failure detail");
    expect(stored).not.toContain("provider/key leaked in code");
  }, 30_000);

  it("paginates equal-cursor action batches and enforces tenant isolation", async () => {
    const context = await testContext("action-pagination");
    const { repository, reservation } = await prepareP4Conversation(
      context,
      "action pagination",
    );
    await repository.applyEvent(
      reservation.conversationId,
      0,
      turnStartedEvent("pagination-eve-turn"),
    );
    await repository.applyEvent(
      reservation.conversationId,
      1,
      actionsRequestedEvent("pagination-eve-turn"),
    );

    const { createConversationActionAuditRepository } = await import(
      "@/src/server/conversations/action-audit-repository"
    );
    const actionRepository = createConversationActionAuditRepository();
    const first = await actionRepository.listPage(
      context.tenantId,
      reservation.conversationId,
      { limit: 2 },
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await actionRepository.listPage(
      context.tenantId,
      reservation.conversationId,
      { limit: 2, before: first.nextCursor ?? undefined },
    );
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(4);

    await expect(
      actionRepository.listPage(randomUUID(), reservation.conversationId, {
        limit: 10,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  }, 30_000);

  it("rolls back an unmatched action result without advancing the cursor", async () => {
    const context = await testContext("action-mismatch");
    const { repository, reservation } = await prepareP4Conversation(
      context,
      "action mismatch",
    );
    await repository.applyEvent(
      reservation.conversationId,
      0,
      turnStartedEvent("mismatch-eve-turn"),
    );
    await expect(
      repository.applyEvent(
        reservation.conversationId,
        1,
        actionResultEvent("mismatch-eve-turn", {
          callId: "unknown-call",
          status: "completed",
          result: {
            kind: "tool-result",
            callId: "unknown-call",
            toolName: "unknown",
            output: null,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_PERSISTENCE_FAILED" });

    const [conversation] = await getDatabase()
      .select({ lastEveCursor: conversations.lastEveCursor })
      .from(conversations)
      .where(eq(conversations.id, reservation.conversationId));
    expect(conversation?.lastEveCursor).toBe(0n);
    const receipts = await getDatabase()
      .select({ id: conversationEventReceipts.id })
      .from(conversationEventReceipts)
      .where(
        and(
          eq(conversationEventReceipts.conversationId, reservation.conversationId),
          eq(conversationEventReceipts.eveCursor, 1n),
        ),
      );
    expect(receipts).toHaveLength(0);
  }, 30_000);
});

async function testContext(label: string): Promise<P4TestContext> {
  const context = await createP4TestContext(label);
  contexts.push(context);
  return context;
}

function turnStartedEvent(turnId: string): HandleMessageStreamEvent {
  return event("turn.started", { turnId, sequence: 1 });
}

function actionsRequestedEvent(turnId: string): HandleMessageStreamEvent {
  return event("actions.requested", {
    turnId,
    stepIndex: 0,
    sequence: 1,
    actions: [
      {
        kind: "tool-call",
        callId: "call-tool",
        toolName: "search_docs",
        input: { query: "sensitive request" },
      },
      {
        kind: "load-skill",
        callId: "call-skill",
        input: { skill: "review" },
      },
      {
        kind: "subagent-call",
        callId: "call-subagent",
        name: "researcher",
        subagentName: "researcher",
        nodeId: "agent/researcher",
        description: "sensitive delegation",
        input: { task: "sensitive task" },
      },
      {
        kind: "remote-agent-call",
        callId: "call-remote",
        name: "remote-researcher",
        remoteAgentName: "remote-researcher",
        nodeId: "remote/researcher",
        description: "sensitive remote delegation",
        input: { task: "sensitive remote task" },
      },
    ],
  });
}

function actionResultEvent(
  turnId: string,
  input: {
    readonly callId: string;
    readonly status: "completed" | "failed" | "rejected";
    readonly errorCode?: string;
    readonly result: Readonly<Record<string, unknown>>;
  },
): HandleMessageStreamEvent {
  return event("action.result", {
    turnId,
    stepIndex: 0,
    sequence: 1,
    status: input.status,
    result: input.result,
    ...(input.errorCode
      ? { error: { code: input.errorCode, message: "sensitive message" } }
      : {}),
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
