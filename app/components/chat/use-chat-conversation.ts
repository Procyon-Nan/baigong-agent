"use client";

import { useRef } from "react";
import {
  chatClientErrorMessage,
  isConversationAuthenticationError,
  requestConversation,
} from "./chat-api-client";
import type { ConversationSnapshot } from "./conversation-data-protocol";
import { useConversationState } from "./conversation-state";
import { useConversationHistory } from "./use-conversation-history";
import { useConversationStream } from "./use-conversation-stream";
import type { ChatMessage } from "./message-state";
import {
  parseConversationMutationResult,
  type ConversationStatus,
  type PublicConversationEvent,
} from "./protocol";

const MAX_MESSAGE_CHARACTERS = 32_000;
const MAX_REQUEST_BYTES = 128 * 1_024;
const REQUEST_ID_SIZE_SAMPLE = "00000000-0000-4000-8000-000000000000";

export type { ChatMessage } from "./message-state";

export function useChatConversation(options: {
  readonly authorizationToken?: string;
  readonly modelAvailable: boolean | null;
  readonly onAuthenticationExpired?: () => void;
}) {
  const { dispatch, getState, state } = useConversationState();
  const cursor = useRef<number | null>(null);
  const lastSubmittedMessage = useRef("");
  const failedSubmission = useRef<FailedSubmission | null>(null);

  function expireAuthentication(
    message = "登录状态已失效，请重新登录。",
  ): void {
    dispatch({ type: "authentication.expired", error: message });
    if (options.onAuthenticationExpired) options.onAuthenticationExpired();
    else window.location.assign("/login");
  }

  function handleEvent(event: PublicConversationEvent): void {
    if (event.type === "authentication.expired") {
      expireAuthentication(event.data.error.message);
      return;
    }
    if (event.type === "turn.failed") {
      failedSubmission.current = {
        text: lastSubmittedMessage.current,
        requestId: crypto.randomUUID(),
        appendUserMessage: false,
        retryOfTurnId: event.data.turnId,
      };
    }
    dispatch({
      type: "public-event.received",
      event,
      failedMessage: lastSubmittedMessage.current,
    });
  }

  const stream = useConversationStream({
    authorizationToken: options.authorizationToken,
    busy: state.busy,
    conversationId: state.conversationId,
    cursor,
    onAuthenticationExpired: expireAuthentication,
    onEvent: handleEvent,
    onReconnectingChange(reconnecting) {
      dispatch({ type: "reconnecting.updated", reconnecting });
    },
    shouldReconnect() {
      const current = getState();
      return (
        current.busy && current.conversationId === state.conversationId
      );
    },
  });

  const history = useConversationHistory({
    authorizationToken: options.authorizationToken,
    dispatch,
    getState,
    onAuthenticationExpired: expireAuthentication,
    onSnapshotLoaded(snapshot, activeInput) {
      stream.stop();
      cursor.current = snapshot.lastEveCursor;
      lastSubmittedMessage.current = activeInput;
      failedSubmission.current = null;
    },
  });

  async function sendMessage(text: string): Promise<void> {
    await submitMessage({
      text,
      requestId: crypto.randomUUID(),
      appendUserMessage: true,
    });
  }

  async function retryFailedMessage(): Promise<void> {
    const submission = failedSubmission.current;
    if (submission) await submitMessage(submission);
  }

  async function submitMessage(submission: FailedSubmission): Promise<void> {
    const current = getState();
    const trimmed = submission.text.trim();
    if (
      !trimmed ||
      current.busy ||
      isTerminal(current.status) ||
      isReadOnly(current.conversationContext, current.archivedAt) ||
      options.modelAvailable === false
    ) {
      return;
    }
    const userMessage = submission.appendUserMessage
      ? createOptimisticUserMessage(trimmed, current.messages)
      : undefined;
    dispatch({ type: "submission.started", userMessage });
    failedSubmission.current = null;
    lastSubmittedMessage.current = trimmed;

    try {
      const creating = current.conversationId === null;
      const result = await requestConversation(
        current.conversationId
          ? `/api/conversations/${current.conversationId}/messages`
          : "/api/conversations",
        {
          authorizationToken: options.authorizationToken,
          method: "POST",
          body: {
            message: trimmed,
            requestId: submission.requestId,
            ...(submission.retryOfTurnId
              ? { retryOfTurnId: submission.retryOfTurnId }
              : {}),
          },
        },
      );
      const mutation = parseConversationMutationResult(result);
      if (!mutation) throw new Error("服务器响应格式无效。");
      if (creating) {
        cursor.current = null;
        history.initializeNewConversation();
      }
      dispatch({
        type: "submission.accepted",
        mutation,
        creating,
        title: trimmed.slice(0, 60),
      });
    } catch (reason) {
      if (isConversationAuthenticationError(reason)) {
        expireAuthentication(chatClientErrorMessage(reason));
        return;
      }
      failedSubmission.current = {
        text: trimmed,
        requestId: submission.requestId,
        appendUserMessage: false,
      };
      dispatch({
        type: "submission.failed",
        error: chatClientErrorMessage(reason),
        failedMessage: trimmed,
      });
    }
  }

  async function cancel(): Promise<void> {
    const current = getState();
    if (!current.conversationId || !current.activeTurnId) return;
    dispatch({ type: "cancel.requested" });
    try {
      await requestConversation(
        `/api/conversations/${current.conversationId}/cancel`,
        {
          authorizationToken: options.authorizationToken,
          method: "POST",
          body: { turnId: current.activeTurnId },
        },
      );
    } catch (reason) {
      if (isConversationAuthenticationError(reason)) {
        expireAuthentication(chatClientErrorMessage(reason));
        return;
      }
      dispatch({
        type: "cancel.failed",
        previousStatus: current.status,
        error: chatClientErrorMessage(reason),
      });
    }
  }

  function newConversation(): void {
    history.reset();
    stream.stop();
    cursor.current = null;
    lastSubmittedMessage.current = "";
    failedSubmission.current = null;
    dispatch({ type: "reset" });
  }

  function updateMessage(value: string): void {
    if (messageFitsRequest(value)) {
      dispatch({ type: "draft.updated", value });
    }
  }

  const readOnly = isReadOnly(state.conversationContext, state.archivedAt);
  return {
    archivedAt: state.archivedAt,
    busy: state.busy,
    cancel,
    cancellable: state.busy && state.activeTurnId !== null,
    conversationContext: state.conversationContext,
    conversationId: state.conversationId,
    conversationTitle: state.conversationTitle,
    error: state.error,
    failedMessage: state.failedMessage,
    hasMoreHistory: state.hasMoreHistory,
    historyRevision: state.historyRevision,
    loadEarlierMessages: history.loadEarlierMessages,
    loadingEarlier: state.loadingEarlier,
    message: state.message,
    messages: state.messages,
    newConversation,
    readOnly,
    reconnecting: state.reconnecting,
    retryFailedMessage,
    revealMessage: history.revealMessage,
    selectConversation: history.selectConversation,
    selecting: state.selecting,
    sendMessage,
    status: state.status,
    subagents: state.subagents,
    terminal: isTerminal(state.status),
    updateMessage,
  } as const;
}

type FailedSubmission = {
  readonly text: string;
  readonly requestId: string;
  readonly appendUserMessage: boolean;
  readonly retryOfTurnId?: string;
};

function createOptimisticUserMessage(
  text: string,
  messages: readonly ChatMessage[],
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    text,
    complete: true,
    createdAt: new Date().toISOString(),
    sequence: nextMessageSequence(messages),
  };
}

function nextMessageSequence(messages: readonly ChatMessage[]): number {
  return (
    messages.reduce(
      (highest, message) => Math.max(highest, message.sequence ?? 0),
      0,
    ) + 1
  );
}

function isTerminal(status: ConversationStatus | null): boolean {
  return status === "TERMINAL_FAILED" || status === "TERMINAL_COMPLETED";
}

function isReadOnly(
  context: ConversationSnapshot["context"] | null,
  archivedAt: string | null,
): boolean {
  return archivedAt !== null || context?.kind === "SUBAGENT";
}

function messageFitsRequest(message: string): boolean {
  if (Array.from(message).length > MAX_MESSAGE_CHARACTERS) return false;
  return (
    new TextEncoder().encode(
      JSON.stringify({ message, requestId: REQUEST_ID_SIZE_SAMPLE }),
    ).byteLength <= MAX_REQUEST_BYTES
  );
}
