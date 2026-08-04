"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { readConversationEventStream } from "./chat-api-client";
import type { PublicConversationEvent } from "./protocol";

const RECONNECT_DELAY_MS = 1_000;

export function useConversationStream(options: {
  readonly authorizationToken?: string;
  readonly busy: boolean;
  readonly conversationId: string | null;
  readonly cursor: RefObject<number | null>;
  readonly onAuthenticationExpired: () => void;
  readonly onEvent: (event: PublicConversationEvent) => void;
  readonly onReconnectingChange: (reconnecting: boolean) => void;
  readonly shouldReconnect: () => boolean;
}) {
  const [reconnectRevision, setReconnectRevision] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const connectionGeneration = useRef(0);
  const callbacks = useRef({
    onAuthenticationExpired: options.onAuthenticationExpired,
    onEvent: options.onEvent,
    onReconnectingChange: options.onReconnectingChange,
    shouldReconnect: options.shouldReconnect,
  });
  callbacks.current = {
    onAuthenticationExpired: options.onAuthenticationExpired,
    onEvent: options.onEvent,
    onReconnectingChange: options.onReconnectingChange,
    shouldReconnect: options.shouldReconnect,
  };

  const stop = useCallback(() => {
    connectionGeneration.current += 1;
    controller.current?.abort();
    controller.current = null;
    clearReconnectTimer(reconnectTimer);
  }, []);

  useEffect(() => {
    if (!options.conversationId || !options.busy) return;
    const generation = ++connectionGeneration.current;
    const activeController = new AbortController();
    controller.current?.abort();
    clearReconnectTimer(reconnectTimer);
    controller.current = activeController;

    void readConversationEventStream({
      authorizationToken: options.authorizationToken,
      conversationId: options.conversationId,
      cursor: options.cursor.current,
      signal: activeController.signal,
      onEvent(event) {
        if (
          activeController.signal.aborted ||
          generation !== connectionGeneration.current ||
          event.conversationId !== options.conversationId
        ) {
          return;
        }
        if (
          event.type !== "heartbeat" &&
          event.type !== "authentication.expired" &&
          options.cursor.current !== null &&
          event.cursor <= options.cursor.current
        ) {
          return;
        }
        if (event.type !== "heartbeat") options.cursor.current = event.cursor;
        callbacks.current.onEvent(event);
      },
      onAuthenticationExpired() {
        callbacks.current.onAuthenticationExpired();
      },
    }).then((endedNormally) => {
      if (
        !endedNormally ||
        activeController.signal.aborted ||
        generation !== connectionGeneration.current ||
        !callbacks.current.shouldReconnect()
      ) {
        return;
      }
      callbacks.current.onReconnectingChange(true);
      reconnectTimer.current = window.setTimeout(() => {
        reconnectTimer.current = null;
        if (generation === connectionGeneration.current) {
          setReconnectRevision((revision) => revision + 1);
        }
      }, RECONNECT_DELAY_MS);
    });

    return () => {
      activeController.abort();
      clearReconnectTimer(reconnectTimer);
      if (controller.current === activeController) controller.current = null;
    };
  }, [
    options.authorizationToken,
    options.busy,
    options.conversationId,
    options.cursor,
    reconnectRevision,
  ]);

  return { stop } as const;
}

function clearReconnectTimer(
  timer: RefObject<number | null>,
): void {
  if (timer.current === null) return;
  window.clearTimeout(timer.current);
  timer.current = null;
}
