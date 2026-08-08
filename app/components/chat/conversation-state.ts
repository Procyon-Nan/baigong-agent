"use client";

import { useCallback, useReducer, useRef } from "react";
import type {
  ConversationSnapshot,
  ConversationSubagent,
} from "./conversation-data-protocol";
import {
  applyAssistantDelta,
  completeAssistantMessage,
  discardIncompleteAssistantMessage,
  type ChatMessage,
} from "./message-state";
import type {
  ConversationMutationResult,
  ConversationStatus,
  PublicPendingInput,
  PublicTodoItem,
  PublicConversationEvent,
} from "./protocol";

export type ConversationViewState = {
  readonly messages: readonly ChatMessage[];
  readonly message: string;
  readonly conversationId: string | null;
  readonly conversationTitle: string;
  readonly conversationContext: ConversationSnapshot["context"] | null;
  readonly archivedAt: string | null;
  readonly subagents: readonly ConversationSubagent[];
  readonly todos: readonly PublicTodoItem[];
  readonly pendingInput: PublicPendingInput | null;
  readonly activeTurnId: string | null;
  readonly status: ConversationStatus | null;
  readonly busy: boolean;
  readonly selecting: boolean;
  readonly loadingEarlier: boolean;
  readonly hasMoreHistory: boolean;
  readonly historyRevision: number;
  readonly error: string;
  readonly failedMessage: string;
  readonly reconnecting: boolean;
};

export type ConversationStateAction =
  | { readonly type: "reset" }
  | { readonly type: "draft.updated"; readonly value: string }
  | { readonly type: "selection.started" }
  | { readonly type: "selection.finished" }
  | { readonly type: "selection.failed"; readonly error: string }
  | {
      readonly type: "snapshot.applied";
      readonly snapshot: ConversationSnapshot;
      readonly messages: readonly ChatMessage[];
    }
  | {
      readonly type: "submission.started";
      readonly userMessage?: ChatMessage;
    }
  | {
      readonly type: "submission.accepted";
      readonly mutation: ConversationMutationResult;
      readonly creating: boolean;
      readonly title: string;
    }
  | {
      readonly type: "submission.failed";
      readonly error: string;
      readonly failedMessage: string;
    }
  | { readonly type: "history.loading"; readonly loading: boolean }
  | {
      readonly type: "history.prepended";
      readonly messages: readonly ChatMessage[];
      readonly hasMore: boolean;
    }
  | { readonly type: "cancel.requested" }
  | {
      readonly type: "cancel.failed";
      readonly previousStatus: ConversationStatus | null;
      readonly error: string;
    }
  | {
      readonly type: "public-event.received";
      readonly event: PublicConversationEvent;
      readonly failedMessage: string;
    }
  | { readonly type: "authentication.expired"; readonly error: string }
  | { readonly type: "error.received"; readonly error: string }
  | { readonly type: "reconnecting.updated"; readonly reconnecting: boolean };

export function useConversationState() {
  const [state, reactDispatch] = useReducer(
    conversationStateReducer,
    undefined,
    createInitialConversationState,
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = useCallback((action: ConversationStateAction) => {
    stateRef.current = conversationStateReducer(stateRef.current, action);
    reactDispatch(action);
  }, []);
  const getState = useCallback(() => stateRef.current, []);

  return { dispatch, getState, state } as const;
}

export function conversationStateReducer(
  state: ConversationViewState,
  action: ConversationStateAction,
): ConversationViewState {
  switch (action.type) {
    case "reset":
      return createInitialConversationState();
    case "draft.updated":
      return { ...state, message: action.value };
    case "selection.started":
      return { ...state, selecting: true, loadingEarlier: false, error: "" };
    case "selection.finished":
      return { ...state, selecting: false };
    case "selection.failed":
      return { ...state, selecting: false, error: action.error };
    case "snapshot.applied": {
      const activeTurnId = action.snapshot.conversation.activeTurn?.id ?? null;
      return {
        ...state,
        messages: action.messages,
        message: "",
        conversationId: action.snapshot.conversation.id,
        conversationTitle: action.snapshot.conversation.title,
        conversationContext: action.snapshot.context,
        archivedAt: action.snapshot.conversation.archivedAt,
        subagents: action.snapshot.subagents,
        todos: action.snapshot.uiState.todos,
        pendingInput: action.snapshot.uiState.pendingInput,
        activeTurnId,
        status: action.snapshot.conversation.status,
        busy: activeTurnId !== null,
        selecting: false,
        hasMoreHistory: action.snapshot.messages.nextCursor !== null,
        error: "",
        failedMessage: "",
        reconnecting: false,
      };
    }
    case "submission.started":
      return {
        ...state,
        messages: action.userMessage
          ? [...state.messages, action.userMessage]
          : state.messages,
        message: "",
        pendingInput: null,
        busy: true,
        error: "",
        failedMessage: "",
      };
    case "submission.accepted":
      return {
        ...state,
        conversationId: action.mutation.conversationId,
        conversationTitle: action.creating
          ? action.title
          : state.conversationTitle,
        conversationContext: action.creating
          ? mainConversationContext()
          : state.conversationContext,
        archivedAt: action.creating ? null : state.archivedAt,
        activeTurnId: action.mutation.turnId,
        status: action.mutation.status,
        historyRevision: state.historyRevision + 1,
      };
    case "submission.failed":
      return {
        ...state,
        busy: false,
        failedMessage: action.failedMessage,
        error: action.error,
      };
    case "history.loading":
      return { ...state, loadingEarlier: action.loading };
    case "history.prepended":
      return {
        ...state,
        messages: prependUniqueMessages(state.messages, action.messages),
        hasMoreHistory: action.hasMore,
      };
    case "cancel.requested":
      return { ...state, status: "CANCELLING" };
    case "cancel.failed":
      return {
        ...state,
        status: action.previousStatus,
        error: action.error,
      };
    case "public-event.received":
      return applyPublicEvent(state, action.event, action.failedMessage);
    case "authentication.expired":
      return {
        ...state,
        busy: false,
        error: action.error,
        reconnecting: false,
      };
    case "error.received":
      return { ...state, error: action.error };
    case "reconnecting.updated":
      return { ...state, reconnecting: action.reconnecting };
  }
}

export function createInitialConversationState(): ConversationViewState {
  return {
    messages: [],
    message: "",
    conversationId: null,
    conversationTitle: "新对话",
    conversationContext: null,
    archivedAt: null,
    subagents: [],
    todos: [],
    pendingInput: null,
    activeTurnId: null,
    status: null,
    busy: false,
    selecting: false,
    loadingEarlier: false,
    hasMoreHistory: false,
    historyRevision: 0,
    error: "",
    failedMessage: "",
    reconnecting: false,
  };
}

function applyPublicEvent(
  state: ConversationViewState,
  event: PublicConversationEvent,
  failedMessage: string,
): ConversationViewState {
  const current = { ...state, reconnecting: false };
  switch (event.type) {
    case "conversation.status":
      if (event.data.status === "WAITING" && state.activeTurnId !== null) {
        return current;
      }
      return event.data.status === "WAITING" || isTerminal(event.data.status)
        ? {
            ...current,
            status: event.data.status,
            busy: false,
            activeTurnId: null,
            historyRevision: state.historyRevision + 1,
          }
        : { ...current, status: event.data.status };
    case "turn.started":
      return {
        ...current,
        activeTurnId: event.data.turnId,
        pendingInput: null,
        status: state.status === "CANCELLING" ? "CANCELLING" : "RUNNING",
        busy: true,
      };
    case "assistant.delta":
      return {
        ...current,
        messages: applyAssistantDelta(state.messages, {
          id: event.data.blockId,
          delta: event.data.delta,
          snapshot: event.data.text,
          createdAt: event.at,
        }),
      };
    case "assistant.completed":
      return {
        ...current,
        messages: completeAssistantMessage(
          state.messages,
          event.data.blockId,
          event.data.text,
          event.at,
        ),
      };
    case "subagent.created":
      return {
        ...current,
        subagents: mergeSubagents(state.subagents, {
          conversationId: event.data.childConversationId,
          name: event.data.name,
          linkStatus: event.data.linkStatus,
          status: event.data.status,
          createdAt: event.at,
        }),
      };
    case "input.requested":
      return { ...current, pendingInput: event.data };
    case "todo.updated":
      return { ...current, todos: event.data.items };
    case "turn.completed":
      return event.data.turnId === state.activeTurnId
        ? { ...current, activeTurnId: null }
        : current;
    case "turn.cancelled":
      return event.data.turnId === state.activeTurnId
        ? {
            ...current,
            activeTurnId: null,
            pendingInput: null,
            error: "已停止生成。",
          }
        : current;
    case "turn.failed":
      return event.data.turnId === state.activeTurnId
        ? {
            ...current,
            messages: event.data.discardBlockId
              ? discardIncompleteAssistantMessage(
                  state.messages,
                  event.data.discardBlockId,
                )
              : state.messages,
            failedMessage,
            error: event.data.error.message,
            activeTurnId: null,
            pendingInput: null,
          }
        : current;
    case "authentication.expired":
    case "heartbeat":
      return current;
  }
}

function prependUniqueMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): readonly ChatMessage[] {
  const existingIds = new Set(current.map((message) => message.id));
  return [
    ...incoming.filter((message) => !existingIds.has(message.id)),
    ...current,
  ];
}

function mergeSubagents(
  current: readonly ConversationSubagent[],
  incoming: ConversationSubagent,
): readonly ConversationSubagent[] {
  const index = current.findIndex(
    (subagent) => subagent.conversationId === incoming.conversationId,
  );
  if (index < 0) return [...current, incoming];
  return current.map((subagent, itemIndex) =>
    itemIndex === index ? incoming : subagent,
  );
}

function mainConversationContext(): ConversationSnapshot["context"] {
  return {
    kind: "MAIN",
    parentConversationId: null,
    subagentName: null,
    linkStatus: "NOT_APPLICABLE",
  };
}

function isTerminal(status: ConversationStatus): boolean {
  return status === "TERMINAL_FAILED" || status === "TERMINAL_COMPLETED";
}
