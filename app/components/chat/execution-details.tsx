"use client";

import { ChevronRight, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  AdminEventStreamAuthenticationError,
  readAdminEventStream,
  type AdminRawEvent,
} from "./admin-event-stream";
import styles from "./chat-workspace.module.css";

export function ExecutionDetails({
  conversationId,
  onAuthenticationExpired,
  onClose,
}: {
  readonly conversationId: string;
  readonly onAuthenticationExpired: () => void;
  readonly onClose: () => void;
}) {
  const [events, setEvents] = useState<AdminRawEvent[]>([]);
  const [autoFollow, setAutoFollow] = useState(true);
  const [connectionState, setConnectionState] = useState<
    "connecting" | "live" | "reconnecting"
  >("connecting");
  const end = useRef<HTMLDivElement | null>(null);
  const authenticationExpired = useRef(onAuthenticationExpired);

  useEffect(() => {
    authenticationExpired.current = onAuthenticationExpired;
  }, [onAuthenticationExpired]);

  useEffect(() => {
    setEvents([]);
    let nextIndex = 0;
    const controller = new AbortController();

    async function connect() {
      let firstConnection = true;
      while (!controller.signal.aborted) {
        setConnectionState(firstConnection ? "connecting" : "reconnecting");
        try {
          nextIndex = await readAdminEventStream({
            conversationId,
            startIndex: nextIndex,
            signal: controller.signal,
            onEvents(incoming) {
              setConnectionState("live");
              setEvents((current) => [...current, ...incoming]);
            },
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof AdminEventStreamAuthenticationError) {
            authenticationExpired.current();
            return;
          }
        }
        firstConnection = false;
        if (!(await reconnectDelay(controller.signal))) return;
      }
    }

    void connect();
    return () => controller.abort();
  }, [conversationId]);

  useEffect(() => {
    if (autoFollow) end.current?.scrollIntoView({ block: "end" });
  }, [autoFollow, events.length]);

  return (
    <aside className={styles.executionPanel} aria-label="执行详情">
      <header className={styles.executionHeader}>
        <div>
          <strong>执行详情</strong>
          <small>{connectionLabel(connectionState)}</small>
        </div>
        <div className={styles.executionActions}>
          <button
            aria-label="清空事件显示"
            className={styles.detailIconButton}
            disabled={events.length === 0}
            onClick={() => setEvents([])}
            title="清空事件显示"
            type="button"
          >
            <Trash2 aria-hidden="true" size={15} />
          </button>
          <button
            aria-label="关闭执行详情"
            className={styles.detailIconButton}
            onClick={onClose}
            title="关闭执行详情"
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      </header>
      <label className={styles.followControl}>
        <input
          checked={autoFollow}
          onChange={(event) => setAutoFollow(event.target.checked)}
          type="checkbox"
        />
        <span>自动跟随</span>
      </label>
      <div className={styles.executionEvents}>
        {events.length === 0 ? (
          <p className={styles.executionEmpty}>等待事件</p>
        ) : (
          events.map((event) => (
            <details className={styles.rawEvent} key={event.index}>
              <summary>
                <ChevronRight
                  aria-hidden="true"
                  className={styles.eventChevron}
                  size={13}
                />
                <span className={styles.eventIndex}>#{event.index + 1}</span>
                <strong>{event.type}</strong>
                <time dateTime={event.at ?? undefined}>
                  {formatEventTime(event.at)}
                </time>
              </summary>
              <pre>{JSON.stringify(event.raw, null, 2)}</pre>
            </details>
          ))
        )}
        <div ref={end} />
      </div>
    </aside>
  );
}

function connectionLabel(
  state: "connecting" | "live" | "reconnecting",
): string {
  if (state === "live") return "实时";
  if (state === "reconnecting") return "正在重连";
  return "正在连接";
}

function formatEventTime(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function reconnectDelay(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve(true);
    }, 1_000);
    function abort() {
      window.clearTimeout(timeout);
      resolve(false);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}
