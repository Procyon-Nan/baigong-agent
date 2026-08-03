"use client";

import { useEffect, useRef, useState } from "react";
import {
  chatClientErrorMessage,
  isConversationAuthenticationError,
  readConversationEventStream,
  requestConversation,
} from "./chat-api-client";
import {
  applyAssistantDelta,
  completeAssistantMessage,
  discardIncompleteAssistantMessage,
  type ChatMessage,
} from "./message-state";
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConversationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failedMessage, setFailedMessage] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [streamGeneration, setStreamGeneration] = useState(0);
  const cursor = useRef<number | null>(null);
  const lastSubmittedMessage = useRef("");
  const failedSubmission = useRef<FailedSubmission | null>(null);
  const streamAbort = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!conversationId || !busy) return;
    const controller = new AbortController();
    streamAbort.current?.abort();
    streamAbort.current = controller;

    void readConversationEventStream({
      authorizationToken: options.authorizationToken,
      conversationId,
      cursor: cursor.current,
      signal: controller.signal,
      onEvent(event) {
        if (
          controller.signal.aborted ||
          event.conversationId !== conversationId
        ) {
          return;
        }
        if (
          event.type !== "heartbeat" &&
          event.type !== "authentication.expired" &&
          cursor.current !== null &&
          event.cursor <= cursor.current
        ) {
          return;
        }
        handleEvent(event);
      },
      onAuthenticationExpired: expireAuthentication,
    }).then((endedNormally) => {
      if (endedNormally && busyRef.current && !controller.signal.aborted) {
        setReconnecting(true);
        window.setTimeout(
          () => setStreamGeneration((generation) => generation + 1),
          1_000,
        );
      }
    });

    return () => controller.abort();
  }, [options.authorizationToken, busy, conversationId, streamGeneration]);

  async function sendMessage(text: string) {
    await submitMessage({
      text,
      requestId: crypto.randomUUID(),
      appendUserMessage: true,
    });
  }

  async function retryFailedMessage() {
    const submission = failedSubmission.current;
    if (submission) await submitMessage(submission);
  }

  async function submitMessage(submission: FailedSubmission) {
    const { appendUserMessage, requestId, text } = submission;
    const trimmed = text.trim();
    if (
      !trimmed ||
      busyRef.current ||
      isTerminal(status) ||
      options.modelAvailable === false
    ) {
      return;
    }
    if (appendUserMessage) {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed,
        complete: true,
      };
      setMessages((current) => [...current, userMessage]);
    }
    setMessage("");
    setError("");
    setFailedMessage("");
    failedSubmission.current = null;
    lastSubmittedMessage.current = trimmed;
    setBusy(true);
    busyRef.current = true;

    try {
      const result = await requestConversation(
        conversationId
          ? `/api/conversations/${conversationId}/messages`
          : "/api/conversations",
        {
          authorizationToken: options.authorizationToken,
          method: "POST",
          body: {
            message: trimmed,
            requestId,
            ...(submission.retryOfTurnId
              ? { retryOfTurnId: submission.retryOfTurnId }
              : {}),
          },
        },
      );
      const mutation = parseConversationMutationResult(result);
      if (!mutation) throw new Error("服务器响应格式无效。");
      if (!conversationId) cursor.current = null;
      setConversationId(mutation.conversationId);
      setActiveTurnId(mutation.turnId);
      setStatus(mutation.status);
    } catch (reason) {
      busyRef.current = false;
      setBusy(false);
      if (isConversationAuthenticationError(reason)) {
        expireAuthentication(chatClientErrorMessage(reason));
        return;
      }
      failedSubmission.current = {
        text: trimmed,
        requestId,
        appendUserMessage: false,
      };
      setFailedMessage(trimmed);
      setError(chatClientErrorMessage(reason));
    }
  }

  async function cancel() {
    if (!conversationId || !activeTurnId) return;
    setStatus("CANCELLING");
    try {
      await requestConversation(`/api/conversations/${conversationId}/cancel`, {
        authorizationToken: options.authorizationToken,
        method: "POST",
        body: { turnId: activeTurnId },
      });
    } catch (reason) {
      if (isConversationAuthenticationError(reason)) {
        expireAuthentication(chatClientErrorMessage(reason));
        return;
      }
      setError(chatClientErrorMessage(reason));
    }
  }

  function newConversation() {
    streamAbort.current?.abort();
    busyRef.current = false;
    cursor.current = null;
    lastSubmittedMessage.current = "";
    setMessages([]);
    setMessage("");
    setConversationId(null);
    setActiveTurnId(null);
    setStatus(null);
    setBusy(false);
    setError("");
    setFailedMessage("");
    failedSubmission.current = null;
    setReconnecting(false);
  }

  function updateMessage(value: string) {
    if (messageFitsRequest(value)) setMessage(value);
  }

  function handleEvent(event: PublicConversationEvent) {
    setReconnecting(false);
    if (event.type !== "heartbeat") cursor.current = event.cursor;
    switch (event.type) {
      case "conversation.status":
        setStatus(event.data.status);
        if (event.data.status === "WAITING" || isTerminal(event.data.status)) {
          finishTurn();
        }
        break;
      case "turn.started":
        setActiveTurnId(event.data.turnId);
        break;
      case "assistant.delta":
        setMessages((current) =>
          applyAssistantDelta(current, {
            id: event.data.blockId,
            delta: event.data.delta,
            snapshot: event.data.text,
          }),
        );
        break;
      case "assistant.completed":
        setMessages((current) =>
          completeAssistantMessage(
            current,
            event.data.blockId,
            event.data.text,
          ),
        );
        break;
      case "turn.completed":
        setActiveTurnId(null);
        break;
      case "turn.cancelled":
        setActiveTurnId(null);
        setError("已停止生成。");
        break;
      case "turn.failed": {
        const discardBlockId = event.data.discardBlockId;
        if (discardBlockId) {
          setMessages((current) =>
            discardIncompleteAssistantMessage(current, discardBlockId),
          );
        }
        failedSubmission.current = {
          text: lastSubmittedMessage.current,
          requestId: crypto.randomUUID(),
          appendUserMessage: false,
          retryOfTurnId: event.data.turnId,
        };
        setFailedMessage(lastSubmittedMessage.current);
        setError(event.data.error.message);
        setActiveTurnId(null);
        break;
      }
      case "authentication.expired":
        expireAuthentication(event.data.error.message);
        break;
      case "heartbeat":
        break;
    }
  }

  function finishTurn() {
    busyRef.current = false;
    setBusy(false);
    setActiveTurnId(null);
    setReconnecting(false);
  }

  function expireAuthentication(message = "登录状态已失效，请重新登录。") {
    busyRef.current = false;
    setBusy(false);
    setError(message);
    setReconnecting(false);
    if (options.onAuthenticationExpired) options.onAuthenticationExpired();
    else window.location.assign("/login");
  }

  return {
    busy,
    cancel,
    cancellable: busy && activeTurnId !== null,
    conversationId,
    error,
    failedMessage,
    message,
    messages,
    newConversation,
    reconnecting,
    retryFailedMessage,
    sendMessage,
    status,
    terminal: isTerminal(status),
    updateMessage,
  } as const;
}

type FailedSubmission = {
  readonly text: string;
  readonly requestId: string;
  readonly appendUserMessage: boolean;
  readonly retryOfTurnId?: string;
};

function isTerminal(status: ConversationStatus | null): boolean {
  return status === "TERMINAL_FAILED" || status === "TERMINAL_COMPLETED";
}

function messageFitsRequest(message: string): boolean {
  if (Array.from(message).length > MAX_MESSAGE_CHARACTERS) return false;
  return (
    new TextEncoder().encode(
      JSON.stringify({ message, requestId: REQUEST_ID_SIZE_SAMPLE }),
    ).byteLength <= MAX_REQUEST_BYTES
  );
}
