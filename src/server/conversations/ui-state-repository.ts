import "server-only";

import { and, eq } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import type { Database } from "@/src/server/db/client";
import { conversationUiStates } from "@/src/server/db/schema";
import type { PublicConversationUiState } from "@/src/shared/conversation-ui-state";
import type { ConversationEventPersistenceContext } from "./repository-types";
import { findInteractionProjectionOrigin } from "./subagent-linking";
import {
  projectInputRequests,
  projectTodoItems,
} from "./ui-state-projection";

const EMPTY_UI_STATE: PublicConversationUiState = {
  todos: [],
  pendingInput: null,
};

export async function persistConversationUiState(
  context: ConversationEventPersistenceContext,
): Promise<void> {
  switch (context.event.type) {
    case "action.result":
      await persistTodoResult(context, context.event);
      return;
    case "input.requested":
      await persistInputRequest(context, context.event);
      return;
    case "turn.started":
    case "message.received":
    case "turn.cancelled":
    case "turn.failed":
    case "session.completed":
    case "session.failed":
      await clearPendingInput(context);
      return;
    default:
      return;
  }
}

export async function readConversationUiState(
  database: Pick<Database, "select">,
  tenantId: string,
  conversationId: string,
): Promise<PublicConversationUiState> {
  const [state] = await database
    .select({
      todos: conversationUiStates.todos,
      pendingInput: conversationUiStates.pendingInput,
    })
    .from(conversationUiStates)
    .where(
      and(
        eq(conversationUiStates.tenantId, tenantId),
        eq(conversationUiStates.conversationId, conversationId),
      ),
    )
    .limit(1);
  return state ?? EMPTY_UI_STATE;
}

async function persistTodoResult(
  context: ConversationEventPersistenceContext,
  event: Extract<HandleMessageStreamEvent, { type: "action.result" }>,
): Promise<void> {
  const todos = projectTodoItems(event);
  if (!todos) return;
  await context.transaction
    .insert(conversationUiStates)
    .values({
      conversationId: context.conversation.id,
      tenantId: context.conversation.tenantId,
      todos,
      todoEveCursor: context.cursor,
      updatedAt: context.eventAt,
    })
    .onConflictDoUpdate({
      target: conversationUiStates.conversationId,
      set: {
        todos,
        todoEveCursor: context.cursor,
        updatedAt: context.eventAt,
      },
    });
}

async function persistInputRequest(
  context: ConversationEventPersistenceContext,
  event: Extract<HandleMessageStreamEvent, { type: "input.requested" }>,
): Promise<void> {
  if (context.conversation.kind !== "MAIN") return;
  const requests = projectInputRequests(event);
  if (!requests) return;
  const origin = await findInteractionProjectionOrigin(
    context.transaction,
    context.conversation.id,
    event.data.turnId,
  );
  if (!origin) return;
  const pendingInput = { origin, requests } as const;
  await context.transaction
    .insert(conversationUiStates)
    .values({
      conversationId: context.conversation.id,
      tenantId: context.conversation.tenantId,
      pendingInput,
      inputEveCursor: context.cursor,
      updatedAt: context.eventAt,
    })
    .onConflictDoUpdate({
      target: conversationUiStates.conversationId,
      set: {
        pendingInput,
        inputEveCursor: context.cursor,
        updatedAt: context.eventAt,
      },
    });
}

async function clearPendingInput(
  context: ConversationEventPersistenceContext,
): Promise<void> {
  await context.transaction
    .update(conversationUiStates)
    .set({
      pendingInput: null,
      inputEveCursor: null,
      updatedAt: context.eventAt,
    })
    .where(
      and(
        eq(conversationUiStates.conversationId, context.conversation.id),
        eq(conversationUiStates.tenantId, context.conversation.tenantId),
      ),
    );
}
