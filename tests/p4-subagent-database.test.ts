import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDatabase } from "@/src/server/db/client";
import {
  conversationDerivedProjectionStates,
  conversationMessages,
  conversations,
  conversationTurns,
  securityAuditEvents,
} from "@/src/server/db/schema";
import type { ConversationRepository } from "@/src/server/conversations/repository";
import { getConversationSnapshot } from "@/src/server/conversations/service";
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

describe("P4 subagent linking", () => {
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

  it("creates, verifies, and exposes a read-only child mapping idempotently", async () => {
    const context = await testContext("subagent-verified");
    const prepared = await prepareSubagent(context, "researcher");
    const { repository, parentConversationId, childConversationId } = prepared;

    expect(
      await repository.resolveInteractionOrigin(
        parentConversationId,
        prepared.parentEveTurnId,
      ),
    ).toBe("MAIN");
    expect(
      await repository.resolveInteractionOrigin(
        parentConversationId,
        prepared.childEveTurnId,
      ),
    ).toBeNull();

    await expect(
      repository.getOwnedConversation(
        context.administrator,
        childConversationId,
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

    expect(
      await repository.applyEvent(
        parentConversationId,
        2,
        subagentCalledEvent(prepared),
      ),
    ).toBe(false);
    expect(
      await repository.applyEvent(
        parentConversationId,
        3,
        subagentCalledEvent(prepared),
      ),
    ).toBe(true);

    const started = childSessionStartedEvent(prepared);
    expect(await repository.applyEvent(childConversationId, 0, started)).toBe(
      true,
    );
    expect(await repository.applyEvent(childConversationId, 0, started)).toBe(
      false,
    );
    expect(await repository.applyEvent(childConversationId, 1, started)).toBe(
      true,
    );

    const [linked] = await getDatabase()
      .select()
      .from(conversations)
      .where(eq(conversations.id, childConversationId));
    expect(linked).toMatchObject({
      kind: "SUBAGENT",
      parentConversationId,
      parentTurnId: prepared.parentTurnId,
      delegationCallId: prepared.callId,
      subagentName: "researcher",
      linkStatus: "VERIFIED",
      parentCalledCursor: 2n,
      childStartedCursor: 0n,
      status: "RUNNING",
    });
    await expect(
      getConversationSnapshot(context.administrator, parentConversationId),
    ).resolves.toMatchObject({
      context: {
        kind: "MAIN",
        parentConversationId: null,
        subagentName: null,
        linkStatus: "NOT_APPLICABLE",
      },
      subagents: [
        {
          conversationId: childConversationId,
          name: "researcher",
          linkStatus: "VERIFIED",
          status: "RUNNING",
        },
      ],
    });
    await repository.applyEvent(
      childConversationId,
      2,
      turnStartedEvent(prepared.childEveTurnId),
    );
    expect(
      await repository.resolveInteractionOrigin(
        parentConversationId,
        prepared.childEveTurnId,
      ),
    ).toBe("SUBAGENT");
    expect(
      await repository.resolveInteractionOrigin(
        parentConversationId,
        `unknown-${randomUUID()}`,
      ),
    ).toBeNull();
    await repository.applyEvent(
      childConversationId,
      3,
      childMessageReceivedEvent(
        prepared.childEveTurnId,
        "检查知识库中的发票规则。",
      ),
    );
    const [delegation] = await getDatabase()
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, childConversationId),
          eq(conversationMessages.role, "DELEGATION"),
        ),
      );
    expect(delegation?.body).toBe("检查知识库中的发票规则。");
    expect(delegation?.body).not.toContain("You are the subagent");

    await repository.applyEvent(
      childConversationId,
      4,
      sessionCompletedEvent(),
    );
    await expect(
      repository.reserveContinuation(
        context.administrator,
        childConversationId,
        { message: "continue", requestId: randomUUID() },
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_UNAVAILABLE" });
    await expect(
      repository.getOwnedConversation(
        context.administrator,
        childConversationId,
      ),
    ).resolves.toMatchObject({
      id: childConversationId,
      status: "TERMINAL_COMPLETED",
    });

    const other = await testContext("subagent-other-owner");
    await expect(
      repository.getOwnedConversation(other.administrator, childConversationId),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  }, 30_000);

  it.each([
    "parentSessionId",
    "parentTurnId",
    "parentCallId",
    "name",
  ] as const)(
    "fails closed when child invocation %s does not match",
    async (field) => {
      const context = await testContext(`subagent-mismatch-${field}`);
      const prepared = await prepareSubagent(context, "reviewer");
      const invocation = validInvocation(prepared);
      const mismatched = {
        ...invocation,
        [field]: `mismatch-${field}`,
      };

      await prepared.repository.applyEvent(
        prepared.childConversationId,
        0,
        event("session.started", { invocation: mismatched }),
      );

      const [child] = await getDatabase()
        .select()
        .from(conversations)
        .where(eq(conversations.id, prepared.childConversationId));
      expect(child).toMatchObject({
        linkStatus: "FAILED",
        status: "TERMINAL_FAILED",
        activeTurnId: null,
      });
      const [turn] = await getDatabase()
        .select()
        .from(conversationTurns)
        .where(eq(conversationTurns.conversationId, prepared.childConversationId));
      expect(turn).toMatchObject({
        status: "FAILED",
        publicErrorCode: "CONVERSATION_UNAVAILABLE",
      });
      const audits = await getDatabase()
        .select()
        .from(securityAuditEvents)
        .where(
          and(
            eq(
              securityAuditEvents.action,
              "SUBAGENT_LINK_VERIFICATION_FAILED",
            ),
            eq(securityAuditEvents.targetId, prepared.childConversationId),
          ),
        );
      expect(audits).toHaveLength(1);
      await expect(
        prepared.repository.getOwnedConversation(
          context.administrator,
          prepared.childConversationId,
        ),
      ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    },
    30_000,
  );

  it("settles a pending child immediately when the parent reports delegation failure", async () => {
    const context = await testContext("subagent-parent-failure");
    const prepared = await prepareSubagent(context, "researcher");

    await prepared.repository.applyEvent(
      prepared.parentConversationId,
      3,
      actionResultEvent(
        prepared.parentEveTurnId,
        prepared.callId,
        prepared.name,
        "failed",
      ),
    );

    const [child] = await getDatabase()
      .select()
      .from(conversations)
      .where(eq(conversations.id, prepared.childConversationId));
    const [turn] = await getDatabase()
      .select()
      .from(conversationTurns)
      .where(eq(conversationTurns.conversationId, prepared.childConversationId));
    expect(child).toMatchObject({
      linkStatus: "FAILED",
      status: "TERMINAL_FAILED",
      activeTurnId: null,
      encryptedContinuationToken: null,
    });
    expect(turn).toMatchObject({
      status: "FAILED",
      publicErrorCode: "REQUEST_FAILED",
    });
  }, 30_000);

  it("persists core lifecycle before a derived projection and replays projection lag", async () => {
    const context = await testContext("derived-projection-replay");
    const { repository, reservation } = await prepareP4Conversation(
      context,
      "projection replay",
    );
    const { createConversationEventPersistence } = await import(
      "@/src/server/conversations/event-persistence"
    );
    let attempts = 0;
    const persistence = createConversationEventPersistence(getDatabase(), {
      persistDerived: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("injected derived failure");
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const started = turnStartedEvent(`turn-${randomUUID()}`);

    await expect(
      persistence.applyEvent(reservation.conversationId, 0, started),
    ).resolves.toBe(true);
    const [afterFailure] = await getDatabase()
      .select()
      .from(conversationDerivedProjectionStates)
      .where(
        eq(
          conversationDerivedProjectionStates.conversationId,
          reservation.conversationId,
        ),
      );
    const [conversation] = await getDatabase()
      .select()
      .from(conversations)
      .where(eq(conversations.id, reservation.conversationId));
    expect(conversation.lastEveCursor).toBe(0n);
    expect(afterFailure).toMatchObject({
      lastEveCursor: null,
      failureCount: 1,
      lastFailureCode: "UNCLASSIFIED_ERROR",
    });
    await expect(
      repository.getReconciliationStartIndex(reservation.conversationId),
    ).resolves.toBe(0);
    await expect(repository.listPendingConversationIds(50)).resolves.toContain(
      reservation.conversationId,
    );

    await expect(
      persistence.applyEvent(reservation.conversationId, 0, started),
    ).resolves.toBe(false);
    const [replayed] = await getDatabase()
      .select()
      .from(conversationDerivedProjectionStates)
      .where(
        eq(
          conversationDerivedProjectionStates.conversationId,
          reservation.conversationId,
        ),
      );
    expect(replayed).toMatchObject({
      lastEveCursor: 0n,
      failureCount: 0,
      lastFailureCode: null,
    });
    await expect(
      repository.getReconciliationStartIndex(reservation.conversationId),
    ).resolves.toBe(1);
    expect(attempts).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  }, 30_000);

  it("counts three main turns separately from six active subagents", async () => {
    const context = await testContext("separate-concurrency");
    const { repository, reservation } = await prepareP4Conversation(
      context,
      "delegate concurrently",
    );
    const parentEveTurnId = `parent-turn-${randomUUID()}`;
    await repository.applyEvent(
      reservation.conversationId,
      0,
      turnStartedEvent(parentEveTurnId),
    );
    const [parent] = await getDatabase()
      .select({ eveSessionId: conversations.eveSessionId })
      .from(conversations)
      .where(eq(conversations.id, reservation.conversationId));
    if (!parent?.eveSessionId) throw new Error("Expected a parent eve session.");

    for (let index = 0; index < 7; index += 1) {
      const callId = `call-${randomUUID()}`;
      const name = `worker-${index + 1}`;
      const childSessionId = `child-${randomUUID()}`;
      await repository.applyEvent(
        reservation.conversationId,
        index * 2 + 1,
        actionsRequestedEvent(parentEveTurnId, callId, name),
      );
      await repository.applyEvent(
        reservation.conversationId,
        index * 2 + 2,
        event("subagent.called", {
          callId,
          childSessionId,
          sessionId: parent.eveSessionId,
          sequence: index + 1,
          name,
          toolName: name,
          turnId: parentEveTurnId,
          workflowId: "workflow-main",
        }),
      );
    }

    const children = await getDatabase()
      .select({ status: conversations.status, linkStatus: conversations.linkStatus })
      .from(conversations)
      .where(eq(conversations.parentConversationId, reservation.conversationId));
    expect(
      children.filter(
        (child) =>
          child.linkStatus === "PENDING" && child.status === "STARTING",
      ),
    ).toHaveLength(6);
    expect(
      children.filter(
        (child) =>
          child.linkStatus === "FAILED" &&
          child.status === "TERMINAL_FAILED",
      ),
    ).toHaveLength(1);

    await expect(
      repository.reserveCreation(context.administrator, {
        message: "second main turn",
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({ kind: "reserved" });
    await expect(
      repository.reserveCreation(context.administrator, {
        message: "third main turn",
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({ kind: "reserved" });
    await expect(
      repository.reserveCreation(context.administrator, {
        message: "fourth main turn",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "USER_CONCURRENCY_LIMIT" });
  }, 30_000);
});

type PreparedSubagent = {
  readonly repository: ConversationRepository;
  readonly parentConversationId: string;
  readonly parentTurnId: string;
  readonly parentEveSessionId: string;
  readonly parentEveTurnId: string;
  readonly childConversationId: string;
  readonly childEveSessionId: string;
  readonly childEveTurnId: string;
  readonly callId: string;
  readonly name: string;
};

async function testContext(label: string): Promise<P4TestContext> {
  const context = await createP4TestContext(label);
  contexts.push(context);
  return context;
}

async function prepareSubagent(
  context: P4TestContext,
  name: string,
): Promise<PreparedSubagent> {
  const { repository, reservation } = await prepareP4Conversation(
    context,
    `delegate to ${name}`,
  );
  const parentEveTurnId = `parent-turn-${randomUUID()}`;
  const callId = `call-${randomUUID()}`;
  const childEveSessionId = `child-session-${randomUUID()}`;
  const childEveTurnId = `child-turn-${randomUUID()}`;
  await repository.applyEvent(
    reservation.conversationId,
    0,
    turnStartedEvent(parentEveTurnId),
  );
  await repository.applyEvent(
    reservation.conversationId,
    1,
    actionsRequestedEvent(parentEveTurnId, callId, name),
  );
  const [parent] = await getDatabase()
    .select({ eveSessionId: conversations.eveSessionId })
    .from(conversations)
    .where(eq(conversations.id, reservation.conversationId));
  if (!parent?.eveSessionId) throw new Error("Expected a parent eve session.");
  const provisional = {
    repository,
    parentConversationId: reservation.conversationId,
    parentTurnId: reservation.turnId,
    parentEveSessionId: parent.eveSessionId,
    parentEveTurnId,
    childConversationId: "",
    childEveSessionId,
    childEveTurnId,
    callId,
    name,
  } satisfies PreparedSubagent;
  await repository.applyEvent(
    reservation.conversationId,
    2,
    subagentCalledEvent(provisional),
  );
  const [child] = await getDatabase()
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.parentConversationId, reservation.conversationId),
        eq(conversations.delegationCallId, callId),
      ),
    );
  if (!child) throw new Error("Expected a child conversation mapping.");
  return { ...provisional, childConversationId: child.id };
}

function validInvocation(input: PreparedSubagent) {
  return {
    kind: "subagent" as const,
    parentCallId: input.callId,
    parentSessionId: input.parentEveSessionId,
    parentTurnId: input.parentEveTurnId,
    name: input.name,
  };
}

function childSessionStartedEvent(
  _input: PreparedSubagent,
): HandleMessageStreamEvent {
  return event("session.started", {});
}

function turnStartedEvent(turnId: string): HandleMessageStreamEvent {
  return event("turn.started", { turnId, sequence: 1 });
}

function actionsRequestedEvent(
  turnId: string,
  callId: string,
  name: string,
): HandleMessageStreamEvent {
  return event("actions.requested", {
    turnId,
    stepIndex: 0,
    sequence: 1,
    actions: [
      {
        kind: "subagent-call",
        callId,
        name,
        subagentName: name,
        nodeId: `subagents/${name}`,
        description: `${name} subagent`,
        input: { message: "delegated task" },
      },
    ],
  });
}

function subagentCalledEvent(
  input: PreparedSubagent,
): HandleMessageStreamEvent {
  return event("subagent.called", {
    callId: input.callId,
    childSessionId: input.childEveSessionId,
    sessionId: input.parentEveSessionId,
    sequence: 1,
    name: input.name,
    toolName: input.name,
    turnId: input.parentEveTurnId,
    workflowId: "workflow-main",
  });
}

function actionResultEvent(
  turnId: string,
  callId: string,
  name: string,
  status: "failed" | "rejected",
): HandleMessageStreamEvent {
  return event("action.result", {
    turnId,
    stepIndex: 0,
    sequence: 1,
    status,
    error: { code: "SUBAGENT_EXECUTION_FAILED", message: "failed" },
    result: {
      kind: "subagent-result",
      callId,
      subagentName: name,
      isError: true,
      output: "failed",
    },
  });
}

function childMessageReceivedEvent(
  turnId: string,
  message: string,
): HandleMessageStreamEvent {
  return event("message.received", {
    turnId,
    sequence: 1,
    message: [
      'You are the subagent "researcher".',
      "Description: Reviews source material.",
      "",
      "The caller delegated the following task to you. Complete it and return the final result directly.",
      "",
      "Caller message:",
      message,
    ].join("\n"),
    content: [{ type: "text", text: message }],
  });
}

function sessionCompletedEvent(): HandleMessageStreamEvent {
  return event("session.completed", {});
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
