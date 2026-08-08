import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import {
  conversationEventReceipts,
  conversationAttachments,
  conversationMessages,
  conversationStateEvents,
  conversationTurns,
  conversations,
  type ConversationStatus,
  type ConversationTurnStatus,
} from "@/src/server/db/schema";
import { conversationPersistenceFailure } from "./errors";
import {
  assistantMessageBlockId,
  delegationMessageBlockId,
  userMessageBlockId,
} from "./message-identifiers";
import type {
  ConversationEventPersistenceContext,
  ConversationTransaction,
} from "./repository-types";
import { findConversationTurnByEveId } from "./turn-repository";
import { extractSubagentDelegationMessage } from "./subagent-linking";

export async function recordConversationEventReceipt(
  transaction: ConversationTransaction,
  input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly eveCursor: bigint;
    readonly eventType: HandleMessageStreamEvent["type"];
    readonly eventAt: Date;
  },
): Promise<boolean> {
  const [inserted] = await transaction
    .insert(conversationEventReceipts)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: conversationEventReceipts.id });
  return Boolean(inserted);
}

export async function persistConversationHistoryEvent(
  context: ConversationEventPersistenceContext,
): Promise<void> {
  await persistMessageEvent(context);
  await persistStateEvent(context);
}

async function persistMessageEvent(
  context: ConversationEventPersistenceContext,
): Promise<void> {
  switch (context.event.type) {
    case "message.received":
      await persistReceivedMessage(context, context.event);
      return;
    case "message.appended":
      await persistAssistantMessage(context, {
        body: context.event.data.messageSoFar,
        status: "STREAMING",
        stepIndex: context.event.data.stepIndex,
        eveTurnId: context.event.data.turnId,
      });
      return;
    case "message.completed":
      if (context.event.data.message === null) return;
      await persistAssistantMessage(context, {
        body: context.event.data.message,
        status: "COMPLETED",
        stepIndex: context.event.data.stepIndex,
        eveTurnId: context.event.data.turnId,
      });
      return;
    case "turn.cancelled":
      await settleAssistantDrafts(
        context,
        context.event.data.turnId,
        "STOPPED",
      );
      return;
    case "turn.completed":
    case "turn.failed":
      await settleAssistantDrafts(context, context.event.data.turnId, "HIDDEN");
      return;
    case "session.completed":
    case "session.failed":
      if (context.conversation.activeTurnId) {
        await hideAssistantDraftsByTurnId(
          context,
          context.conversation.activeTurnId,
        );
      }
      return;
    default:
      return;
  }
}

async function persistReceivedMessage(
  context: ConversationEventPersistenceContext,
  event: Extract<HandleMessageStreamEvent, { type: "message.received" }>,
): Promise<void> {
  const turn = await findConversationTurnByEveId(
    context.transaction,
    context.conversation.id,
    event.data.turnId,
  );
  if (!turn) throw conversationPersistenceFailure();

  if (turn.inputMessageId) {
    const [message] = await context.transaction
      .select({ id: conversationMessages.id, body: conversationMessages.body })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, turn.inputMessageId),
          eq(conversationMessages.conversationId, context.conversation.id),
          eq(conversationMessages.role, "USER"),
        ),
      )
      .limit(1);
    if (!message) {
      throw conversationPersistenceFailure();
    }
    const attachments = await context.transaction
      .select({
        displayName: conversationAttachments.displayName,
        mediaType: conversationAttachments.declaredMediaType,
        sizeBytes: conversationAttachments.sizeBytes,
      })
      .from(conversationAttachments)
      .where(
        and(
          eq(conversationAttachments.tenantId, context.conversation.tenantId),
          eq(conversationAttachments.conversationId, context.conversation.id),
          eq(conversationAttachments.messageId, message.id),
          eq(conversationAttachments.status, "BOUND"),
        ),
      );
    if (!receivedMessageMatchesReservation(message.body, attachments, event)) {
      throw conversationPersistenceFailure();
    }
    await context.transaction
      .update(conversationMessages)
      .set({
        firstEveCursor: sql`coalesce(${conversationMessages.firstEveCursor}, ${context.cursor})`,
        lastEveCursor: context.cursor,
        updatedAt: context.eventAt,
      })
      .where(eq(conversationMessages.id, message.id));
    return;
  }

  const messageId = randomUUID();
  const sequence = await allocateMessageSequence(
    context.transaction,
    context.conversation.id,
  );
  const delegation = context.conversation.kind === "SUBAGENT";
  await context.transaction.insert(conversationMessages).values({
    id: messageId,
    tenantId: context.conversation.tenantId,
    conversationId: context.conversation.id,
    turnId: turn.id,
    sequence,
    role: delegation ? "DELEGATION" : "USER",
    status: "COMPLETED",
    blockId: delegation
      ? delegationMessageBlockId(context.conversation.id, turn.id)
      : userMessageBlockId(context.conversation.id, turn.id),
    body: delegation
      ? extractSubagentDelegationMessage(event.data.message)
      : event.data.message,
    firstEveCursor: context.cursor,
    lastEveCursor: context.cursor,
    createdAt: context.eventAt,
    updatedAt: context.eventAt,
  });
  const [updated] = await context.transaction
    .update(conversationTurns)
    .set({ inputMessageId: messageId, updatedAt: context.eventAt })
    .where(
      and(
        eq(conversationTurns.id, turn.id),
        sql`${conversationTurns.inputMessageId} IS NULL`,
      ),
    )
    .returning({ id: conversationTurns.id });
  if (!updated) throw conversationPersistenceFailure();
}

function receivedMessageMatchesReservation(
  message: string,
  attachments: readonly {
    readonly displayName: string;
    readonly mediaType: string;
    readonly sizeBytes: number;
  }[],
  event: Extract<HandleMessageStreamEvent, { type: "message.received" }>,
): boolean {
  if (attachments.length === 0) return event.data.message === message;
  if (!event.data.parts) return false;

  const textParts = event.data.parts.filter(
    (
      part,
    ): part is Extract<(typeof event.data.parts)[number], { type: "text" }> =>
      part.type === "text",
  );
  const expectedTextParts = message.trim().length > 0 ? [message] : [];
  if (
    textParts.length !== expectedTextParts.length ||
    textParts.some((part, index) => part.text !== expectedTextParts[index])
  ) {
    return false;
  }

  const actualFiles = event.data.parts.filter(
    (
      part,
    ): part is Extract<(typeof event.data.parts)[number], { type: "file" }> =>
      part.type === "file",
  );
  if (actualFiles.length !== attachments.length) return false;

  const unmatched = [...attachments];
  for (const file of actualFiles) {
    const index = unmatched.findIndex(
      (attachment) =>
        attachment.displayName === file.filename &&
        attachment.mediaType === file.mediaType &&
        (file.size === undefined || attachment.sizeBytes === file.size),
    );
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return unmatched.length === 0;
}

async function persistAssistantMessage(
  context: ConversationEventPersistenceContext,
  input: {
    readonly body: string;
    readonly status: "STREAMING" | "COMPLETED";
    readonly stepIndex: number;
    readonly eveTurnId: string;
  },
): Promise<void> {
  const turn = await findConversationTurnByEveId(
    context.transaction,
    context.conversation.id,
    input.eveTurnId,
  );
  if (!turn) throw conversationPersistenceFailure();
  const blockId = assistantMessageBlockId(
    context.conversation.id,
    turn.id,
    input.stepIndex,
  );
  const [existing] = await context.transaction
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, context.conversation.id),
        eq(conversationMessages.blockId, blockId),
        eq(conversationMessages.role, "ASSISTANT"),
      ),
    )
    .limit(1);
  if (existing) {
    await context.transaction
      .update(conversationMessages)
      .set({
        body: input.body,
        status: input.status,
        lastEveCursor: context.cursor,
        updatedAt: context.eventAt,
      })
      .where(eq(conversationMessages.id, existing.id));
    return;
  }

  const sequence = await allocateMessageSequence(
    context.transaction,
    context.conversation.id,
  );
  await context.transaction.insert(conversationMessages).values({
    tenantId: context.conversation.tenantId,
    conversationId: context.conversation.id,
    turnId: turn.id,
    sequence,
    role: "ASSISTANT",
    status: input.status,
    blockId,
    body: input.body,
    stepIndex: input.stepIndex,
    firstEveCursor: context.cursor,
    lastEveCursor: context.cursor,
    createdAt: context.eventAt,
    updatedAt: context.eventAt,
  });
}

async function settleAssistantDrafts(
  context: ConversationEventPersistenceContext,
  eveTurnId: string,
  status: "STOPPED" | "HIDDEN",
): Promise<void> {
  const turn = await findConversationTurnByEveId(
    context.transaction,
    context.conversation.id,
    eveTurnId,
  );
  if (!turn) throw conversationPersistenceFailure();
  await updateAssistantDrafts(context, turn.id, status);
}

async function hideAssistantDraftsByTurnId(
  context: ConversationEventPersistenceContext,
  turnId: string,
): Promise<void> {
  await updateAssistantDrafts(context, turnId, "HIDDEN");
}

async function updateAssistantDrafts(
  context: ConversationEventPersistenceContext,
  turnId: string,
  status: "STOPPED" | "HIDDEN",
): Promise<void> {
  await context.transaction
    .update(conversationMessages)
    .set({
      status,
      lastEveCursor: context.cursor,
      updatedAt: context.eventAt,
    })
    .where(
      and(
        eq(conversationMessages.conversationId, context.conversation.id),
        eq(conversationMessages.turnId, turnId),
        eq(conversationMessages.role, "ASSISTANT"),
        eq(conversationMessages.status, "STREAMING"),
      ),
    );
}

async function persistStateEvent(
  context: ConversationEventPersistenceContext,
): Promise<void> {
  const state = await projectStateEvent(context);
  if (!state) return;
  await context.transaction.insert(conversationStateEvents).values({
    tenantId: context.conversation.tenantId,
    conversationId: context.conversation.id,
    turnId: state.turnId,
    eveCursor: context.cursor,
    eventType: context.event.type,
    conversationStatus: state.conversationStatus,
    turnStatus: state.turnStatus,
    publicErrorCode: state.publicErrorCode,
    eventAt: context.eventAt,
  });
}

type StateEventProjection = {
  readonly turnId: string | null;
  readonly conversationStatus: ConversationStatus | null;
  readonly turnStatus: ConversationTurnStatus | null;
  readonly publicErrorCode: string | null;
};

async function projectStateEvent(
  context: ConversationEventPersistenceContext,
): Promise<StateEventProjection | null> {
  switch (context.event.type) {
    case "turn.started": {
      const turn = await findConversationTurnByEveId(
        context.transaction,
        context.conversation.id,
        context.event.data.turnId,
      );
      if (!turn) throw conversationPersistenceFailure();
      return {
        turnId: turn.id,
        conversationStatus:
          turn.id === context.conversation.activeTurnId
            ? context.conversation.status
            : null,
        turnStatus: turn.status,
        publicErrorCode: null,
      };
    }
    case "message.completed": {
      const turn = await findConversationTurnByEveId(
        context.transaction,
        context.conversation.id,
        context.event.data.turnId,
      );
      if (!turn) throw conversationPersistenceFailure();
      return emptyStateProjection(turn.id);
    }
    case "turn.completed":
      return turnStateProjection(
        context,
        context.event.data.turnId,
        "COMPLETED",
      );
    case "turn.failed":
      return turnStateProjection(
        context,
        context.event.data.turnId,
        "FAILED",
        "MODEL_UNAVAILABLE",
      );
    case "turn.cancelled":
      return turnStateProjection(
        context,
        context.event.data.turnId,
        "CANCELLED",
      );
    case "session.waiting": {
      const activeTurn = context.conversation.activeTurnId
        ? await context.transaction
            .select({ status: conversationTurns.status })
            .from(conversationTurns)
            .where(eq(conversationTurns.id, context.conversation.activeTurnId))
            .limit(1)
        : [];
      const waitingSettledActiveTurn =
        activeTurn[0] !== undefined &&
        !["SUBMITTING", "RUNNING", "CANCELLING"].includes(activeTurn[0].status);
      return {
        turnId: waitingSettledActiveTurn
          ? context.conversation.activeTurnId
          : null,
        conversationStatus: "WAITING",
        turnStatus: null,
        publicErrorCode: null,
      };
    }
    case "session.failed":
      return {
        turnId: context.conversation.activeTurnId,
        conversationStatus: "TERMINAL_FAILED",
        turnStatus: context.conversation.activeTurnId ? "FAILED" : null,
        publicErrorCode: "CONVERSATION_UNAVAILABLE",
      };
    case "session.completed":
      return {
        turnId: context.conversation.activeTurnId,
        conversationStatus: "TERMINAL_COMPLETED",
        turnStatus: context.conversation.activeTurnId ? "COMPLETED" : null,
        publicErrorCode: null,
      };
    default:
      return null;
  }
}

async function turnStateProjection(
  context: ConversationEventPersistenceContext,
  eveTurnId: string,
  turnStatus: "COMPLETED" | "FAILED" | "CANCELLED",
  publicErrorCode: string | null = null,
): Promise<StateEventProjection> {
  const turn = await findConversationTurnByEveId(
    context.transaction,
    context.conversation.id,
    eveTurnId,
  );
  if (!turn) throw conversationPersistenceFailure();
  return {
    turnId: turn.id,
    conversationStatus: context.conversation.status,
    turnStatus,
    publicErrorCode,
  };
}

function emptyStateProjection(turnId: string): StateEventProjection {
  return {
    turnId,
    conversationStatus: null,
    turnStatus: null,
    publicErrorCode: null,
  };
}

async function allocateMessageSequence(
  transaction: ConversationTransaction,
  conversationId: string,
): Promise<number> {
  const [updated] = await transaction
    .update(conversations)
    .set({
      nextMessageSequence: sql`${conversations.nextMessageSequence} + 1`,
    })
    .where(eq(conversations.id, conversationId))
    .returning({ sequence: conversations.nextMessageSequence });
  if (!updated) throw conversationPersistenceFailure();
  return updated.sequence;
}
