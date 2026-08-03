import "server-only";

import { and, desc, eq, lt, or } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { getDatabase, type Database } from "@/src/server/db/client";
import {
  conversationActionAudits,
  type ConversationActionStatus,
  type ConversationActionType,
} from "@/src/server/db/schema";
import { conversationPersistenceFailure } from "./errors";
import type { ConversationEventPersistenceContext } from "./repository-types";
import { findConversationTurnByEveId } from "./turn-repository";

const MAX_ACTION_NAME_LENGTH = 240;
const MAX_ACTION_PAGE_SIZE = 100;
const SAFE_ERROR_CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

type ActionsRequestedEvent = Extract<
  HandleMessageStreamEvent,
  { type: "actions.requested" }
>;
type ActionRequested = ActionsRequestedEvent["data"]["actions"][number];
type ActionResultEvent = Extract<
  HandleMessageStreamEvent,
  { type: "action.result" }
>;

export type ConversationActionIndexCursor = {
  readonly requestEveCursor: number;
  readonly id: string;
};

export type ConversationActionIndexEntry = {
  readonly id: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly actionType: ConversationActionType;
  readonly actionName: string;
  readonly status: ConversationActionStatus;
  readonly errorCode: string | null;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly rawDetails: {
    readonly available: boolean;
    readonly startIndex: number;
    readonly endIndex: number | null;
  };
};

export type ConversationActionIndexPage = {
  readonly items: readonly ConversationActionIndexEntry[];
  readonly nextCursor: ConversationActionIndexCursor | null;
};

export async function persistConversationActionAudit(
  context: ConversationEventPersistenceContext,
): Promise<void> {
  switch (context.event.type) {
    case "actions.requested":
      await persistRequestedActions(context, context.event);
      return;
    case "action.result":
      await persistActionResult(context, context.event);
      return;
    default:
      return;
  }
}

export function createConversationActionAuditRepository(
  database: Database = getDatabase(),
) {
  return {
    async listPage(
      tenantId: string,
      conversationId: string,
      input: {
        readonly limit: number;
        readonly before?: ConversationActionIndexCursor;
      },
    ): Promise<ConversationActionIndexPage> {
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > MAX_ACTION_PAGE_SIZE ||
        (input.before !== undefined &&
          (!Number.isSafeInteger(input.before.requestEveCursor) ||
            input.before.requestEveCursor < 0))
      ) {
        throw conversationPersistenceFailure();
      }

      const before = input.before;
      const rows = await database
        .select()
        .from(conversationActionAudits)
        .where(
          and(
            eq(conversationActionAudits.tenantId, tenantId),
            eq(conversationActionAudits.conversationId, conversationId),
            before
              ? or(
                  lt(
                    conversationActionAudits.requestEveCursor,
                    BigInt(before.requestEveCursor),
                  ),
                  and(
                    eq(
                      conversationActionAudits.requestEveCursor,
                      BigInt(before.requestEveCursor),
                    ),
                    lt(conversationActionAudits.id, before.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(
          desc(conversationActionAudits.requestEveCursor),
          desc(conversationActionAudits.id),
        )
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
      const items = pageRows.map(toActionIndexEntry);
      const last = pageRows.at(-1);
      return {
        items,
        nextCursor:
          hasMore && last
            ? {
                requestEveCursor: safeCursorNumber(last.requestEveCursor),
                id: last.id,
              }
            : null,
      };
    },
  };
}

async function persistRequestedActions(
  context: ConversationEventPersistenceContext,
  event: ActionsRequestedEvent,
): Promise<void> {
  if (event.data.actions.length === 0) return;
  const turn = await findConversationTurnByEveId(
    context.transaction,
    context.conversation.id,
    event.data.turnId,
  );
  if (!turn) throw conversationPersistenceFailure();

  for (const action of event.data.actions) {
    const descriptor = describeRequestedAction(action);
    const [inserted] = await context.transaction
      .insert(conversationActionAudits)
      .values({
        tenantId: context.conversation.tenantId,
        conversationId: context.conversation.id,
        turnId: turn.id,
        eveTurnId: event.data.turnId,
        stepIndex: event.data.stepIndex,
        callId: action.callId,
        actionType: descriptor.type,
        actionName: descriptor.name,
        status: "PENDING",
        requestEveCursor: context.cursor,
        detailsAvailable: true,
        startedAt: context.eventAt,
        createdAt: context.eventAt,
        updatedAt: context.eventAt,
      })
      .onConflictDoNothing({
        target: [
          conversationActionAudits.conversationId,
          conversationActionAudits.callId,
        ],
      })
      .returning({ id: conversationActionAudits.id });
    if (inserted) continue;

    const [existing] = await context.transaction
      .select({
        turnId: conversationActionAudits.turnId,
        eveTurnId: conversationActionAudits.eveTurnId,
        stepIndex: conversationActionAudits.stepIndex,
        actionType: conversationActionAudits.actionType,
        actionName: conversationActionAudits.actionName,
      })
      .from(conversationActionAudits)
      .where(
        and(
          eq(conversationActionAudits.conversationId, context.conversation.id),
          eq(conversationActionAudits.callId, action.callId),
        ),
      )
      .limit(1);
    if (
      !existing ||
      existing.turnId !== turn.id ||
      existing.eveTurnId !== event.data.turnId ||
      existing.stepIndex !== event.data.stepIndex ||
      existing.actionType !== descriptor.type ||
      existing.actionName !== descriptor.name
    ) {
      throw conversationPersistenceFailure();
    }
  }
}

async function persistActionResult(
  context: ConversationEventPersistenceContext,
  event: ActionResultEvent,
): Promise<void> {
  const turn = await findConversationTurnByEveId(
    context.transaction,
    context.conversation.id,
    event.data.turnId,
  );
  if (!turn) throw conversationPersistenceFailure();

  const [action] = await context.transaction
    .select()
    .from(conversationActionAudits)
    .where(
      and(
        eq(conversationActionAudits.conversationId, context.conversation.id),
        eq(conversationActionAudits.callId, event.data.result.callId),
      ),
    )
    .limit(1);
  if (
    !action ||
    action.turnId !== turn.id ||
    action.eveTurnId !== event.data.turnId ||
    action.stepIndex !== event.data.stepIndex ||
    action.status !== "PENDING" ||
    !resultMatchesAction(event, action.actionType, action.actionName)
  ) {
    throw conversationPersistenceFailure();
  }

  const status = actionResultStatus(event.data.status);
  const [updated] = await context.transaction
    .update(conversationActionAudits)
    .set({
      status,
      resultEveCursor: context.cursor,
      errorCode:
        status === "FAILED"
          ? safeErrorCode(event.data.error?.code)
          : null,
      completedAt: context.eventAt,
      updatedAt: context.eventAt,
    })
    .where(
      and(
        eq(conversationActionAudits.id, action.id),
        eq(conversationActionAudits.status, "PENDING"),
      ),
    )
    .returning({ id: conversationActionAudits.id });
  if (!updated) throw conversationPersistenceFailure();
}

function describeRequestedAction(action: ActionRequested): {
  readonly type: ConversationActionType;
  readonly name: string;
} {
  switch (action.kind) {
    case "tool-call":
      return { type: "TOOL", name: safeActionName(action.toolName, "tool") };
    case "load-skill":
      return {
        type: "SKILL",
        name: safeActionName(
          typeof action.input.skill === "string" ? action.input.skill : "load_skill",
          "load_skill",
        ),
      };
    case "subagent-call":
      return {
        type: "SUBAGENT",
        name: safeActionName(action.subagentName, "subagent"),
      };
    case "remote-agent-call":
      return {
        type: "REMOTE_AGENT",
        name: safeActionName(action.remoteAgentName, "remote_agent"),
      };
  }
}

function resultMatchesAction(
  event: ActionResultEvent,
  actionType: ConversationActionType,
  actionName: string,
): boolean {
  const result = event.data.result;
  switch (result.kind) {
    case "tool-result":
      return (
        (actionType === "TOOL" || actionType === "TERMINAL") &&
        safeActionName(result.toolName, "tool") === actionName
      );
    case "load-skill-result":
      return (
        actionType === "SKILL" &&
        (result.name === undefined ||
          safeActionName(result.name, "load_skill") === actionName)
      );
    case "subagent-result":
      return (
        (actionType === "SUBAGENT" || actionType === "REMOTE_AGENT") &&
        safeActionName(result.subagentName, "subagent") === actionName
      );
  }
}

function actionResultStatus(
  status: ActionResultEvent["data"]["status"],
): Exclude<ConversationActionStatus, "PENDING"> {
  switch (status) {
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    case "rejected":
      return "REJECTED";
  }
}

function safeActionName(value: string, fallback: string): string {
  const normalized = value.trim() || fallback;
  return Array.from(normalized).slice(0, MAX_ACTION_NAME_LENGTH).join("");
}

function safeErrorCode(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && SAFE_ERROR_CODE.test(normalized)
    ? normalized
    : "ACTION_FAILED";
}

function toActionIndexEntry(
  row: typeof conversationActionAudits.$inferSelect,
): ConversationActionIndexEntry {
  return {
    id: row.id,
    turnId: row.turnId,
    stepIndex: row.stepIndex,
    actionType: row.actionType,
    actionName: row.actionName,
    status: row.status,
    errorCode: row.errorCode,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    rawDetails: {
      available: row.detailsAvailable,
      startIndex: safeCursorNumber(row.requestEveCursor),
      endIndex:
        row.resultEveCursor === null
          ? null
          : safeCursorNumber(row.resultEveCursor),
    },
  };
}

function safeCursorNumber(value: bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw conversationPersistenceFailure();
  }
  return parsed;
}
