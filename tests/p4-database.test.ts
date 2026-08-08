import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, asc, count, eq } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDatabase } from "@/src/server/db/client";
import {
  conversationEventReceipts,
  conversationMessages,
  conversationStateEvents,
  conversationTurns,
  conversations,
} from "@/src/server/db/schema";
import type { ConversationRepository } from "@/src/server/conversations/repository";
import type { ReservedConversationTurn } from "@/src/server/conversations/types";
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

describe("P4 message persistence", () => {
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

  it("stores an accepted user message immediately and rolls back a failed event", async () => {
    const { context, repository, reservation } = await readyConversation(
      "event-rollback",
      "# First message",
    );
    const database = getDatabase();
    const [conversation] = await database
      .select()
      .from(conversations)
      .where(eq(conversations.id, reservation.conversationId));
    const messages = await database
      .select()
      .from(conversationMessages)
      .where(
        eq(conversationMessages.conversationId, reservation.conversationId),
      );

    expect(conversation).toMatchObject({
      tenantId: context.tenantId,
      title: "First message",
      nextMessageSequence: 1,
    });
    expect(messages).toEqual([
      expect.objectContaining({
        turnId: reservation.turnId,
        sequence: 1,
        role: "USER",
        status: "COMPLETED",
        body: "# First message",
      }),
    ]);

    await expect(
      repository.applyEvent(
        reservation.conversationId,
        0,
        messageAppendedEvent("unmapped-turn", 0, "draft"),
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_PERSISTENCE_FAILED" });

    const [receiptCount] = await database
      .select({ value: count() })
      .from(conversationEventReceipts)
      .where(
        eq(
          conversationEventReceipts.conversationId,
          reservation.conversationId,
        ),
      );
    const [unchanged] = await database
      .select({ lastEveCursor: conversations.lastEveCursor })
      .from(conversations)
      .where(eq(conversations.id, reservation.conversationId));
    expect(receiptCount?.value).toBe(0);
    expect(unchanged?.lastEveCursor).toBeNull();

    await expect(
      repository.applyEvent(
        reservation.conversationId,
        0,
        turnEvent("turn.started", "mapped-turn"),
      ),
    ).resolves.toBe(true);
  }, 30_000);

  it("persists completed assistant blocks and keeps a cancelled draft", async () => {
    const { repository, reservation } = await readyConversation(
      "cancelled-draft",
      "keep this question",
    );
    const conversationId = reservation.conversationId;
    const eveTurnId = `eve-${randomUUID()}`;

    await applyEvents(repository, conversationId, [
      turnEvent("turn.started", eveTurnId),
      messageReceivedEvent(eveTurnId, "keep this question"),
      messageAppendedEvent(eveTurnId, 0, "first draft"),
      messageCompletedEvent(eveTurnId, 0, "first answer"),
      messageCompletedEvent(eveTurnId, 1, "second answer"),
      messageAppendedEvent(eveTurnId, 2, "third draft"),
      turnEvent("turn.cancelled", eveTurnId),
      waitingEvent("cancelled-next-token"),
    ]);

    const messages = await getDatabase()
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.sequence));
    expect(messages).toEqual([
      expect.objectContaining({
        role: "USER",
        status: "COMPLETED",
        body: "keep this question",
      }),
      expect.objectContaining({
        role: "ASSISTANT",
        status: "COMPLETED",
        stepIndex: 0,
        body: "first answer",
      }),
      expect.objectContaining({
        role: "ASSISTANT",
        status: "COMPLETED",
        stepIndex: 1,
        body: "second answer",
      }),
      expect.objectContaining({
        role: "ASSISTANT",
        status: "STOPPED",
        stepIndex: 2,
        body: "third draft",
      }),
    ]);

    const stateEvents = await getDatabase()
      .select({
        eventType: conversationStateEvents.eventType,
        turnStatus: conversationStateEvents.turnStatus,
      })
      .from(conversationStateEvents)
      .where(eq(conversationStateEvents.conversationId, conversationId))
      .orderBy(asc(conversationStateEvents.eveCursor));
    expect(stateEvents).toEqual([
      { eventType: "turn.started", turnStatus: "RUNNING" },
      { eventType: "message.completed", turnStatus: null },
      { eventType: "message.completed", turnStatus: null },
      { eventType: "turn.cancelled", turnStatus: "CANCELLED" },
      { eventType: "session.waiting", turnStatus: null },
    ]);
  }, 30_000);

  it("replays a delayed cancellation without blocking the current turn", async () => {
    const { context, repository, reservation } = await readyConversation(
      "delayed-cancellation",
      "first turn",
    );
    const conversationId = reservation.conversationId;
    const firstEveTurnId = `eve-${randomUUID()}`;
    await repository.applyEvent(
      conversationId,
      0,
      turnEvent("turn.started", firstEveTurnId),
    );

    const cancellation = await repository.reserveCancellation(
      context.administrator,
      conversationId,
      reservation.turnId,
    );
    expect(cancellation.kind).toBe("reserved");
    if (cancellation.kind !== "reserved") {
      throw new Error("Expected a cancellation reservation.");
    }
    await repository.settleUnresolvedCancellation(cancellation.value);

    const continuation = await repository.reserveContinuation(
      context.administrator,
      conversationId,
      { message: "second turn", requestId: randomUUID() },
    );
    expect(continuation.kind).toBe("reserved");
    if (continuation.kind !== "reserved") {
      throw new Error("Expected a continuation reservation.");
    }
    await repository.acceptContinuation(
      continuation.value,
      continuation.value.eveSessionId!,
    );

    const secondEveTurnId = `eve-${randomUUID()}`;
    await applyEvents(
      repository,
      conversationId,
      [
        turnEvent("turn.cancelled", firstEveTurnId),
        waitingEvent("delayed-first-token"),
        turnEvent("turn.started", secondEveTurnId),
        turnEvent("turn.cancelled", secondEveTurnId),
        waitingEvent("second-token"),
      ],
      1,
    );

    const [conversation] = await getDatabase()
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    const turns = await getDatabase()
      .select()
      .from(conversationTurns)
      .where(eq(conversationTurns.conversationId, conversationId))
      .orderBy(asc(conversationTurns.createdAt));

    expect(conversation).toMatchObject({
      status: "WAITING",
      activeTurnId: null,
      lastEveCursor: 5n,
    });
    expect(turns).toEqual([
      expect.objectContaining({
        id: reservation.turnId,
        eveTurnId: firstEveTurnId,
        status: "CANCELLED",
      }),
      expect.objectContaining({
        id: continuation.value.turnId,
        eveTurnId: secondEveTurnId,
        status: "CANCELLED",
      }),
    ]);
  }, 30_000);

  it("hides a failed draft and reuses the original user message for retry", async () => {
    const originalMessage = "retry the original question";
    const { context, repository, reservation } = await readyConversation(
      "failed-retry",
      originalMessage,
    );
    const conversationId = reservation.conversationId;
    const failedEveTurnId = `eve-${randomUUID()}`;

    await applyEvents(repository, conversationId, [
      turnEvent("turn.started", failedEveTurnId),
      messageReceivedEvent(failedEveTurnId, originalMessage),
      messageAppendedEvent(failedEveTurnId, 0, "discard me"),
      turnEvent("turn.failed", failedEveTurnId),
      waitingEvent("retry-token"),
    ]);

    const retry = await repository.reserveContinuation(
      context.administrator,
      conversationId,
      {
        message: "client text must not replace the original",
        requestId: randomUUID(),
        retryOfTurnId: reservation.turnId,
      },
    );
    expect(retry.kind).toBe("reserved");
    if (retry.kind !== "reserved") throw new Error("Expected a retry.");
    expect(retry.message).toBe(originalMessage);

    const turns = await getDatabase()
      .select()
      .from(conversationTurns)
      .where(eq(conversationTurns.conversationId, conversationId));
    const originalTurn = turns.find(({ id }) => id === reservation.turnId);
    const retryTurn = turns.find(({ id }) => id === retry.value.turnId);
    expect(retryTurn).toMatchObject({
      inputMessageId: originalTurn?.inputMessageId,
      retryOfTurnId: reservation.turnId,
    });
    await expectUserMessageCount(conversationId, 1);
    expect(await assistantStatuses(conversationId)).toEqual(["HIDDEN"]);

    await repository.acceptContinuation(retry.value, retry.value.eveSessionId!);
    const retryEveTurnId = `eve-${randomUUID()}`;
    await applyEvents(
      repository,
      conversationId,
      [
        turnEvent("turn.started", retryEveTurnId),
        messageReceivedEvent(retryEveTurnId, originalMessage),
        messageCompletedEvent(retryEveTurnId, 0, "recovered answer"),
        turnEvent("turn.completed", retryEveTurnId),
        waitingEvent("after-retry-token"),
      ],
      5,
    );

    expect(await assistantStatuses(conversationId)).toEqual([
      "HIDDEN",
      "COMPLETED",
    ]);
    const repeated = await repository.reserveContinuation(
      context.administrator,
      conversationId,
      { message: originalMessage, requestId: randomUUID() },
    );
    expect(repeated.kind).toBe("reserved");
    await expectUserMessageCount(conversationId, 2);
  }, 30_000);
});

async function readyConversation(
  label: string,
  message: string,
): Promise<{
  readonly context: P4TestContext;
  readonly repository: ConversationRepository;
  readonly reservation: ReservedConversationTurn;
}> {
  const context = await createP4TestContext(label);
  contexts.push(context);
  const prepared = await prepareP4Conversation(context, message);
  return { context, ...prepared };
}

async function applyEvents(
  repository: ConversationRepository,
  conversationId: string,
  events: readonly HandleMessageStreamEvent[],
  startCursor = 0,
): Promise<void> {
  for (const [offset, item] of events.entries()) {
    await repository.applyEvent(conversationId, startCursor + offset, item);
  }
}

async function expectUserMessageCount(
  conversationId: string,
  expected: number,
): Promise<void> {
  const [result] = await getDatabase()
    .select({ value: count() })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.role, "USER"),
      ),
    );
  expect(result?.value).toBe(expected);
}

async function assistantStatuses(conversationId: string): Promise<string[]> {
  const rows = await getDatabase()
    .select({ status: conversationMessages.status })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.role, "ASSISTANT"),
      ),
    )
    .orderBy(asc(conversationMessages.sequence));
  return rows.map(({ status }) => status);
}

function turnEvent(
  type: "turn.started" | "turn.completed" | "turn.failed" | "turn.cancelled",
  turnId: string,
): HandleMessageStreamEvent {
  return event(type, { turnId, sequence: 1 });
}

function messageReceivedEvent(
  turnId: string,
  message: string,
): HandleMessageStreamEvent {
  return event("message.received", { turnId, message, sequence: 1, parts: [] });
}

function messageAppendedEvent(
  turnId: string,
  stepIndex: number,
  messageSoFar: string,
): HandleMessageStreamEvent {
  return event("message.appended", {
    turnId,
    stepIndex,
    sequence: 1,
    messageDelta: messageSoFar,
    messageSoFar,
  });
}

function messageCompletedEvent(
  turnId: string,
  stepIndex: number,
  message: string,
): HandleMessageStreamEvent {
  return event("message.completed", {
    turnId,
    stepIndex,
    sequence: 1,
    message,
    finishReason: "stop",
  });
}

function waitingEvent(continuationToken: string): HandleMessageStreamEvent {
  return event("session.waiting", { continuationToken });
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
