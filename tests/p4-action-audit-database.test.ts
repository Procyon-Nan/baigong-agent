import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDatabase } from "@/src/server/db/client";
import {
  conversationActionAudits,
  conversationDerivedProjectionStates,
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

  it("records projection lag without rolling back core state for an unmatched result", async () => {
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
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    ).resolves.toBe(true);

    const [conversation] = await getDatabase()
      .select({ lastEveCursor: conversations.lastEveCursor })
      .from(conversations)
      .where(eq(conversations.id, reservation.conversationId));
    expect(conversation?.lastEveCursor).toBe(1n);
    const receipts = await getDatabase()
      .select({ id: conversationEventReceipts.id })
      .from(conversationEventReceipts)
      .where(
        and(
          eq(conversationEventReceipts.conversationId, reservation.conversationId),
          eq(conversationEventReceipts.eveCursor, 1n),
        ),
      );
    expect(receipts).toHaveLength(1);
    const [projection] = await getDatabase()
      .select()
      .from(conversationDerivedProjectionStates)
      .where(
        eq(
          conversationDerivedProjectionStates.conversationId,
          reservation.conversationId,
        ),
      );
    expect(projection).toMatchObject({
      lastEveCursor: 0n,
      failureCount: 1,
      lastFailureCode: "CONVERSATION_PERSISTENCE_FAILED",
    });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  }, 30_000);

  it("allows providers to reuse a tool call id in later turns", async () => {
    const context = await testContext("action-call-id-scope");
    const { repository, reservation } = await prepareP4Conversation(
      context,
      "first turn",
    );
    const conversationId = reservation.conversationId;
    const firstEveTurnId = "call-id-first-turn";

    await repository.applyEvent(
      conversationId,
      0,
      turnStartedEvent(firstEveTurnId),
    );
    await repository.applyEvent(
      conversationId,
      1,
      singleToolRequestedEvent(firstEveTurnId, "call_0", "first_tool"),
    );
    await repository.applyEvent(
      conversationId,
      2,
      actionResultEvent(firstEveTurnId, {
        callId: "call_0",
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call_0",
          toolName: "first_tool",
          output: null,
        },
      }),
    );
    await repository.applyEvent(
      conversationId,
      3,
      event("turn.completed", { turnId: firstEveTurnId, sequence: 1 }),
    );
    await repository.applyEvent(
      conversationId,
      4,
      event("session.waiting", {
        continuationToken: `continuation-${randomUUID()}`,
        sequence: 1,
      }),
    );

    const continuation = await repository.reserveContinuation(
      context.administrator,
      conversationId,
      { message: "second turn", requestId: randomUUID() },
    );
    if (continuation.kind !== "reserved" || !continuation.value.eveSessionId) {
      throw new Error("Expected a continuation reservation.");
    }
    await repository.acceptContinuation(
      continuation.value,
      continuation.value.eveSessionId,
    );

    const secondEveTurnId = "call-id-second-turn";
    await repository.applyEvent(
      conversationId,
      5,
      turnStartedEvent(secondEveTurnId),
    );
    await repository.applyEvent(
      conversationId,
      6,
      singleToolRequestedEvent(secondEveTurnId, "call_0", "second_tool"),
    );
    await repository.applyEvent(
      conversationId,
      7,
      actionResultEvent(secondEveTurnId, {
        callId: "call_0",
        status: "failed",
        result: {
          kind: "tool-result",
          callId: "call_0",
          toolName: "second_tool",
          isError: true,
          output: "expected failure",
        },
      }),
    );

    const actions = await getDatabase()
      .select({
        eveTurnId: conversationActionAudits.eveTurnId,
        actionName: conversationActionAudits.actionName,
        status: conversationActionAudits.status,
      })
      .from(conversationActionAudits)
      .where(eq(conversationActionAudits.conversationId, conversationId));
    expect(actions).toEqual(
      expect.arrayContaining([
        {
          eveTurnId: firstEveTurnId,
          actionName: "first_tool",
          status: "COMPLETED",
        },
        {
          eveTurnId: secondEveTurnId,
          actionName: "second_tool",
          status: "FAILED",
        },
      ]),
    );
    expect(actions).toHaveLength(2);
  }, 30_000);

  it("allows a completed call id to be reused in the same turn and step", async () => {
    const context = await testContext("action-call-id-repeat");
    const { repository, reservation } = await prepareP4Conversation(
      context,
      "repeated action",
    );
    const conversationId = reservation.conversationId;
    const eveTurnId = "repeated-action-turn";

    await repository.applyEvent(conversationId, 0, turnStartedEvent(eveTurnId));
    await repository.applyEvent(
      conversationId,
      1,
      singleToolRequestedEvent(eveTurnId, "call_0", "first_tool"),
    );
    await repository.applyEvent(
      conversationId,
      2,
      actionResultEvent(eveTurnId, {
        callId: "call_0",
        status: "failed",
        result: {
          kind: "tool-result",
          callId: "call_0",
          toolName: "first_tool",
          isError: true,
          output: "first failure",
        },
      }),
    );
    await repository.applyEvent(
      conversationId,
      3,
      singleToolRequestedEvent(eveTurnId, "call_0", "second_tool"),
    );
    await repository.applyEvent(
      conversationId,
      4,
      actionResultEvent(eveTurnId, {
        callId: "call_0",
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call_0",
          toolName: "second_tool",
          output: null,
        },
      }),
    );

    const actions = await getDatabase()
      .select({
        actionName: conversationActionAudits.actionName,
        requestEveCursor: conversationActionAudits.requestEveCursor,
        status: conversationActionAudits.status,
      })
      .from(conversationActionAudits)
      .where(eq(conversationActionAudits.conversationId, conversationId));
    expect(actions).toEqual(
      expect.arrayContaining([
        {
          actionName: "first_tool",
          requestEveCursor: 1n,
          status: "FAILED",
        },
        {
          actionName: "second_tool",
          requestEveCursor: 3n,
          status: "COMPLETED",
        },
      ]),
    );
    expect(actions).toHaveLength(2);
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

function singleToolRequestedEvent(
  turnId: string,
  callId: string,
  toolName: string,
): HandleMessageStreamEvent {
  return event("actions.requested", {
    turnId,
    stepIndex: 0,
    sequence: 1,
    actions: [
      {
        kind: "tool-call",
        callId,
        toolName,
        input: {},
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
