import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import type { Database } from "@/src/server/db/client";
import {
  conversationActionAudits,
  conversationTurns,
  conversations,
} from "@/src/server/db/schema";
import { conversationPersistenceFailure } from "./errors";
import type { ConversationEventPersistenceContext } from "./repository-types";

const DELEGATION_MESSAGE_MARKER = "\nCaller message:\n";
const UNKNOWN_DELEGATION_MESSAGE = "主 Agent 已委派任务。";

type SubagentCalledEvent = Extract<
  HandleMessageStreamEvent,
  { type: "subagent.called" }
>;
type SessionStartedEvent = Extract<
  HandleMessageStreamEvent,
  { type: "session.started" }
>;

export type SubagentPublicProjection = {
  readonly conversationId: string;
  readonly name: string;
  readonly linkStatus: "PENDING" | "VERIFIED";
  readonly status: typeof conversations.$inferSelect.status;
};

export type InteractionProjectionOrigin = "MAIN" | "SUBAGENT";

export async function persistSubagentLinking(
  context: ConversationEventPersistenceContext,
): Promise<void> {
  switch (context.event.type) {
    case "subagent.called":
      await persistParentCall(context, context.event);
      return;
    case "session.started":
      if (context.conversation.kind === "SUBAGENT") {
        await verifyChildInvocation(context, context.event);
      }
      return;
    default:
      return;
  }
}

export async function findSubagentPublicProjection(
  database: Pick<Database, "select">,
  parentConversationId: string,
  delegationCallId: string,
): Promise<SubagentPublicProjection | null> {
  const [child] = await database
    .select({
      conversationId: conversations.id,
      name: conversations.subagentName,
      linkStatus: conversations.linkStatus,
      status: conversations.status,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.parentConversationId, parentConversationId),
        eq(conversations.delegationCallId, delegationCallId),
        eq(conversations.kind, "SUBAGENT"),
      ),
    )
    .limit(1);
  if (
    !child?.name ||
    (child.linkStatus !== "PENDING" && child.linkStatus !== "VERIFIED")
  ) {
    return null;
  }
  return {
    conversationId: child.conversationId,
    name: child.name,
    linkStatus: child.linkStatus,
    status: child.status,
  };
}

export async function findInteractionProjectionOrigin(
  database: Pick<Database, "select">,
  parentConversationId: string,
  eveTurnId: string,
): Promise<InteractionProjectionOrigin | null> {
  const [mainTurn] = await database
    .select({ id: conversationTurns.id })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.conversationId, parentConversationId),
        eq(conversationTurns.eveTurnId, eveTurnId),
      ),
    )
    .limit(1);
  if (mainTurn) return "MAIN";

  const [verifiedChildTurn] = await database
    .select({ id: conversationTurns.id })
    .from(conversationTurns)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationTurns.conversationId),
    )
    .where(
      and(
        eq(conversations.parentConversationId, parentConversationId),
        eq(conversations.kind, "SUBAGENT"),
        eq(conversations.linkStatus, "VERIFIED"),
        eq(conversationTurns.eveTurnId, eveTurnId),
      ),
    )
    .limit(1);
  return verifiedChildTurn ? "SUBAGENT" : null;
}

export function extractSubagentDelegationMessage(message: string): string {
  const markerIndex = message.indexOf(DELEGATION_MESSAGE_MARKER);
  if (markerIndex < 0) return UNKNOWN_DELEGATION_MESSAGE;
  const delegated = message
    .slice(markerIndex + DELEGATION_MESSAGE_MARKER.length)
    .trim();
  return delegated || UNKNOWN_DELEGATION_MESSAGE;
}

async function persistParentCall(
  context: ConversationEventPersistenceContext,
  event: SubagentCalledEvent,
): Promise<void> {
  const [action] = await context.transaction
    .select()
    .from(conversationActionAudits)
    .where(
      and(
        eq(
          conversationActionAudits.conversationId,
          context.conversation.id,
        ),
        eq(conversationActionAudits.callId, event.data.callId),
      ),
    )
    .limit(1);
  if (!action) throw conversationPersistenceFailure();
  if (action.actionType === "REMOTE_AGENT") return;
  if (action.actionType !== "SUBAGENT") {
    throw conversationPersistenceFailure();
  }

  const [parentTurn] = await context.transaction
    .select()
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.id, action.turnId),
        eq(conversationTurns.conversationId, context.conversation.id),
      ),
    )
    .limit(1);
  if (
    !parentTurn?.eveTurnId ||
    !context.conversation.eveSessionId ||
    event.data.callId.length === 0 ||
    event.data.childSessionId.length === 0 ||
    event.data.remote !== undefined ||
    event.data.sessionId !== context.conversation.eveSessionId ||
    event.data.turnId !== parentTurn.eveTurnId ||
    action.eveTurnId !== parentTurn.eveTurnId ||
    action.actionName !== event.data.toolName ||
    !isValidSubagentName(event.data.toolName)
  ) {
    throw conversationPersistenceFailure();
  }

  const [existing] = await context.transaction
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.parentConversationId, context.conversation.id),
        eq(conversations.delegationCallId, event.data.callId),
      ),
    )
    .limit(1);
  if (existing) {
    if (
      existing.tenantId !== context.conversation.tenantId ||
      existing.ownerUserId !== context.conversation.ownerUserId ||
      existing.ownerSource !== context.conversation.ownerSource ||
      existing.parentTurnId !== parentTurn.id ||
      existing.subagentName !== event.data.toolName ||
      existing.eveSessionId !== event.data.childSessionId
    ) {
      throw conversationPersistenceFailure();
    }
    return;
  }

  const childConversationId = randomUUID();
  const childTurnId = randomUUID();
  await context.transaction.insert(conversations).values({
    id: childConversationId,
    tenantId: context.conversation.tenantId,
    ownerUserId: context.conversation.ownerUserId,
    ownerSource: context.conversation.ownerSource,
    kind: "SUBAGENT",
    title: event.data.toolName,
    parentConversationId: context.conversation.id,
    parentTurnId: parentTurn.id,
    delegationCallId: event.data.callId,
    subagentName: event.data.toolName,
    linkStatus: "PENDING",
    parentCalledCursor: context.cursor,
    agentId: event.data.toolName,
    eveSessionId: event.data.childSessionId,
    status: "STARTING",
    activeTurnId: childTurnId,
    nextMessageSequence: 0,
    createdAt: context.eventAt,
    updatedAt: context.eventAt,
  });
  await context.transaction.insert(conversationTurns).values({
    id: childTurnId,
    tenantId: context.conversation.tenantId,
    conversationId: childConversationId,
    ownerUserId: context.conversation.ownerUserId,
    requestId: randomUUID(),
    modelConfigVersionId: parentTurn.modelConfigVersionId,
    status: "SUBMITTING",
    createdAt: context.eventAt,
    updatedAt: context.eventAt,
  });
}

async function verifyChildInvocation(
  context: ConversationEventPersistenceContext,
  event: SessionStartedEvent,
): Promise<void> {
  const child = context.conversation;
  if (child.linkStatus === "FAILED") return;
  const invocation = event.data.invocation;
  const [parent] = child.parentConversationId
    ? await context.transaction
        .select()
        .from(conversations)
        .where(eq(conversations.id, child.parentConversationId))
        .limit(1)
    : [];
  const [parentTurn] = child.parentTurnId
    ? await context.transaction
        .select()
        .from(conversationTurns)
        .where(eq(conversationTurns.id, child.parentTurnId))
        .limit(1)
    : [];
  const [action] = child.parentConversationId && child.delegationCallId
    ? await context.transaction
        .select()
        .from(conversationActionAudits)
        .where(
          and(
            eq(
              conversationActionAudits.conversationId,
              child.parentConversationId,
            ),
            eq(conversationActionAudits.callId, child.delegationCallId),
          ),
        )
        .limit(1)
    : [];

  const childModelConfigVersionId = await childModelVersion(
    context,
    child.activeTurnId,
  );
  const valid =
    invocation?.kind === "subagent" &&
    parent !== undefined &&
    parentTurn !== undefined &&
    action !== undefined &&
    parent.id === child.parentConversationId &&
    parent.tenantId === child.tenantId &&
    parent.ownerUserId === child.ownerUserId &&
    parent.ownerSource === child.ownerSource &&
    parent.eveSessionId === invocation.parentSessionId &&
    parentTurn.id === child.parentTurnId &&
    parentTurn.conversationId === parent.id &&
    parentTurn.eveTurnId === invocation.parentTurnId &&
    parentTurn.modelConfigVersionId === childModelConfigVersionId &&
    action.turnId === parentTurn.id &&
    action.actionType === "SUBAGENT" &&
    action.actionName === child.subagentName &&
    action.callId === invocation.parentCallId &&
    child.delegationCallId === invocation.parentCallId &&
    child.subagentName === invocation.name;

  if (!valid) {
    await failChildLink(context);
    return;
  }
  if (child.linkStatus === "VERIFIED") return;

  const [updated] = await context.transaction
    .update(conversations)
    .set({
      linkStatus: "VERIFIED",
      childStartedCursor: context.cursor,
      status: "RUNNING",
      updatedAt: context.eventAt,
    })
    .where(
      and(
        eq(conversations.id, child.id),
        eq(conversations.linkStatus, "PENDING"),
      ),
    )
    .returning({ id: conversations.id });
  if (!updated) throw conversationPersistenceFailure();
}

async function childModelVersion(
  context: ConversationEventPersistenceContext,
  activeTurnId: string | null,
): Promise<string | null> {
  if (!activeTurnId) return null;
  const [turn] = await context.transaction
    .select({ modelConfigVersionId: conversationTurns.modelConfigVersionId })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.id, activeTurnId),
        eq(conversationTurns.conversationId, context.conversation.id),
      ),
    )
    .limit(1);
  return turn?.modelConfigVersionId ?? null;
}

async function failChildLink(
  context: ConversationEventPersistenceContext,
): Promise<void> {
  const child = context.conversation;
  if (child.activeTurnId) {
    await context.transaction
      .update(conversationTurns)
      .set({
        status: "FAILED",
        publicErrorCode: "CONVERSATION_UNAVAILABLE",
        completedAt: context.eventAt,
        updatedAt: context.eventAt,
      })
      .where(eq(conversationTurns.id, child.activeTurnId));
  }
  await context.transaction
    .update(conversations)
    .set({
      linkStatus: "FAILED",
      childStartedCursor: child.childStartedCursor ?? context.cursor,
      status: "TERMINAL_FAILED",
      activeTurnId: null,
      encryptedContinuationToken: null,
      updatedAt: context.eventAt,
    })
    .where(eq(conversations.id, child.id));
  await writeSecurityAudit(context.transaction, {
    tenantId: child.tenantId,
    actorSource: "SYSTEM",
    action: "SUBAGENT_LINK_VERIFICATION_FAILED",
    targetType: "CONVERSATION",
    targetId: child.id,
    outcome: "FAILURE",
    metadata: {
      parentConversationId: child.parentConversationId,
      reason: "INVOCATION_MISMATCH",
    },
  });
}

function isValidSubagentName(value: string): boolean {
  return value.length > 0 && value.length <= 120 && value.trim() === value;
}
