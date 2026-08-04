"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  chatClientErrorMessage,
  isConversationAuthenticationError,
  readConversationData,
} from "./chat-api-client";
import {
  parseConversationHistoryPage,
  parseConversationSnapshot,
  type ConversationSnapshot,
} from "./conversation-data-protocol";
import { fromConversationHistoryMessage } from "./conversation-message-adapter";
import type {
  ConversationStateAction,
  ConversationViewState,
} from "./conversation-state";
import type { ChatMessage } from "./message-state";

type HistoryOperation = {
  readonly controller: AbortController;
  readonly generation: number;
};

export function useConversationHistory(options: {
  readonly authorizationToken?: string;
  readonly dispatch: (action: ConversationStateAction) => void;
  readonly getState: () => ConversationViewState;
  readonly onAuthenticationExpired: (message: string) => void;
  readonly onSnapshotLoaded: (
    snapshot: ConversationSnapshot,
    activeInput: string,
  ) => void;
}) {
  const optionsRef = useRef(options);
  const historyCursor = useRef<string | null>(null);
  const selectionController = useRef<AbortController | null>(null);
  const selectionGeneration = useRef(0);
  const historyOperation = useRef<HistoryOperation | null>(null);
  const historyGeneration = useRef(0);
  const actions = useRef({
    initializeNewConversation,
    loadEarlierMessages,
    reset,
    revealMessage,
    selectConversation,
  });
  optionsRef.current = options;
  actions.current = {
    initializeNewConversation,
    loadEarlierMessages,
    reset,
    revealMessage,
    selectConversation,
  };

  useEffect(
    () => () => {
      selectionGeneration.current += 1;
      selectionController.current?.abort();
      historyGeneration.current += 1;
      historyOperation.current?.controller.abort();
    },
    [],
  );

  async function selectConversation(conversationId: string): Promise<void> {
    if (conversationId === optionsRef.current.getState().conversationId) return;
    const generation = ++selectionGeneration.current;
    const controller = new AbortController();
    selectionController.current?.abort();
    stopHistoryOperation();
    selectionController.current = controller;
    optionsRef.current.dispatch({ type: "selection.started" });
    try {
      const payload = await readConversationData(
        `/api/conversations/${conversationId}`,
        {
          authorizationToken: optionsRef.current.authorizationToken,
          signal: controller.signal,
        },
      );
      const snapshot = parseConversationSnapshot(payload);
      if (!snapshot) throw new Error("服务器响应格式无效。");
      if (!isCurrentSelection(generation, controller)) return;
      historyCursor.current = snapshot.messages.nextCursor;
      const messages = snapshot.messages.items.map(
        fromConversationHistoryMessage,
      );
      optionsRef.current.onSnapshotLoaded(
        snapshot,
        activeInputMessage(snapshot),
      );
      optionsRef.current.dispatch({
        type: "snapshot.applied",
        snapshot,
        messages,
      });
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (handleRequestError(reason)) {
        optionsRef.current.dispatch({ type: "selection.finished" });
        return;
      }
      optionsRef.current.dispatch({
        type: "selection.failed",
        error: chatClientErrorMessage(reason),
      });
    } finally {
      if (selectionGeneration.current === generation) {
        selectionController.current = null;
      }
    }
  }

  async function loadEarlierMessages(): Promise<void> {
    const state = optionsRef.current.getState();
    const before = historyCursor.current;
    if (
      !state.conversationId ||
      !before ||
      state.loadingEarlier ||
      historyOperation.current
    ) {
      return;
    }
    const operation = startHistoryOperation();
    optionsRef.current.dispatch({ type: "history.loading", loading: true });
    try {
      const page = await readHistoryPage(
        state.conversationId,
        before,
        operation.controller.signal,
      );
      if (!isCurrentHistoryOperation(operation, state.conversationId)) return;
      historyCursor.current = page.nextCursor;
      optionsRef.current.dispatch({
        type: "history.prepended",
        messages: page.items.map(fromConversationHistoryMessage),
        hasMore: page.nextCursor !== null,
      });
    } catch (reason) {
      if (operation.controller.signal.aborted) return;
      if (!handleRequestError(reason)) {
        optionsRef.current.dispatch({
          type: "error.received",
          error: chatClientErrorMessage(reason),
        });
      }
    } finally {
      finishHistoryOperation(operation, true);
    }
  }

  async function revealMessage(
    messageId: string,
    sequence: number,
  ): Promise<boolean> {
    if (
      containsHistoryMessage(
        optionsRef.current.getState().messages,
        messageId,
        sequence,
      )
    ) {
      return true;
    }
    const conversationId = optionsRef.current.getState().conversationId;
    if (!conversationId) return false;
    stopHistoryOperation();
    const operation = startHistoryOperation();
    let before = historyCursor.current;
    const incoming: ChatMessage[] = [];
    try {
      while (before && isCurrentHistoryOperation(operation, conversationId)) {
        const page = await readHistoryPage(
          conversationId,
          before,
          operation.controller.signal,
        );
        if (!isCurrentHistoryOperation(operation, conversationId)) return false;
        incoming.unshift(...page.items.map(fromConversationHistoryMessage));
        before = page.nextCursor;
        if (containsHistoryMessage(incoming, messageId, sequence)) break;
      }
      if (!isCurrentHistoryOperation(operation, conversationId)) return false;
      historyCursor.current = before;
      if (incoming.length > 0) {
        optionsRef.current.dispatch({
          type: "history.prepended",
          messages: incoming,
          hasMore: before !== null,
        });
      }
      return containsHistoryMessage(
        [...incoming, ...optionsRef.current.getState().messages],
        messageId,
        sequence,
      );
    } catch (reason) {
      if (operation.controller.signal.aborted) return false;
      if (!handleRequestError(reason)) {
        optionsRef.current.dispatch({
          type: "error.received",
          error: chatClientErrorMessage(reason),
        });
      }
      return false;
    } finally {
      finishHistoryOperation(operation, false);
    }
  }

  function reset(): void {
    selectionGeneration.current += 1;
    selectionController.current?.abort();
    selectionController.current = null;
    stopHistoryOperation();
    historyCursor.current = null;
  }

  function initializeNewConversation(): void {
    historyCursor.current = null;
  }

  async function readHistoryPage(
    conversationId: string,
    cursor: string,
    signal: AbortSignal,
  ) {
    const payload = await readConversationData(
      `/api/conversations/${conversationId}/messages?cursor=${encodeURIComponent(cursor)}`,
      { authorizationToken: optionsRef.current.authorizationToken, signal },
    );
    const page = parseConversationHistoryPage(payload);
    if (!page) throw new Error("服务器响应格式无效。");
    return page;
  }

  function handleRequestError(reason: unknown): boolean {
    if (!isConversationAuthenticationError(reason)) return false;
    optionsRef.current.onAuthenticationExpired(chatClientErrorMessage(reason));
    return true;
  }

  function isCurrentSelection(
    generation: number,
    controller: AbortController,
  ): boolean {
    return (
      generation === selectionGeneration.current && !controller.signal.aborted
    );
  }

  function startHistoryOperation(): HistoryOperation {
    const operation = {
      controller: new AbortController(),
      generation: ++historyGeneration.current,
    };
    historyOperation.current = operation;
    return operation;
  }

  function stopHistoryOperation(): void {
    const operation = historyOperation.current;
    if (!operation) return;
    historyGeneration.current += 1;
    operation.controller.abort();
    historyOperation.current = null;
    optionsRef.current.dispatch({ type: "history.loading", loading: false });
  }

  function isCurrentHistoryOperation(
    operation: HistoryOperation,
    conversationId: string,
  ): boolean {
    return (
      historyOperation.current === operation &&
      operation.generation === historyGeneration.current &&
      !operation.controller.signal.aborted &&
      optionsRef.current.getState().conversationId === conversationId
    );
  }

  function finishHistoryOperation(
    operation: HistoryOperation,
    wasLoadingEarlier: boolean,
  ): void {
    if (historyOperation.current !== operation) return;
    historyOperation.current = null;
    if (wasLoadingEarlier) {
      optionsRef.current.dispatch({ type: "history.loading", loading: false });
    }
  }

  const initializeNewConversationCallback = useCallback(() => {
    actions.current.initializeNewConversation();
  }, []);
  const loadEarlierMessagesCallback = useCallback(
    () => actions.current.loadEarlierMessages(),
    [],
  );
  const resetCallback = useCallback(() => actions.current.reset(), []);
  const revealMessageCallback = useCallback(
    (messageId: string, sequence: number) =>
      actions.current.revealMessage(messageId, sequence),
    [],
  );
  const selectConversationCallback = useCallback(
    (conversationId: string) =>
      actions.current.selectConversation(conversationId),
    [],
  );

  return {
    initializeNewConversation: initializeNewConversationCallback,
    loadEarlierMessages: loadEarlierMessagesCallback,
    reset: resetCallback,
    revealMessage: revealMessageCallback,
    selectConversation: selectConversationCallback,
  } as const;
}

function activeInputMessage(snapshot: ConversationSnapshot): string {
  const activeTurnId = snapshot.conversation.activeTurn?.id;
  if (!activeTurnId) return "";
  return (
    snapshot.messages.items.findLast(
      (message) => message.turnId === activeTurnId && message.role === "USER",
    )?.body ?? ""
  );
}

function containsHistoryMessage(
  messages: readonly ChatMessage[],
  messageId: string,
  sequence: number,
): boolean {
  return messages.some(
    (message) =>
      message.id === messageId ||
      (message.role === "user" && message.sequence === sequence),
  );
}
