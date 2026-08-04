"use client";

import { Bot, Check, Copy, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConversationSubagent } from "./conversation-data-protocol";
import { MarkdownContent } from "./markdown-content";
import type { ChatMessage } from "./message-state";
import { SubagentCard } from "./subagent-card";
import styles from "./conversation-history.module.css";

export function ConversationHistory({
  conversationId,
  hasMoreHistory,
  loadingEarlier,
  messages,
  onLoadEarlier,
  onOpenSubagent,
  onVisibleUserMessageChange,
  scrollRequest,
  subagents,
}: {
  readonly conversationId: string | null;
  readonly hasMoreHistory: boolean;
  readonly loadingEarlier: boolean;
  readonly messages: readonly ChatMessage[];
  readonly onLoadEarlier: () => Promise<void>;
  readonly onOpenSubagent: (conversationId: string) => void;
  readonly onVisibleUserMessageChange: (
    message: { readonly id: string; readonly sequence?: number } | null,
  ) => void;
  readonly scrollRequest: {
    readonly messageId: string;
    readonly messageSequence: number;
    readonly sequence: number;
  } | null;
  readonly subagents: readonly ConversationSubagent[];
}) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const topSentinel = useRef<HTMLDivElement | null>(null);
  const previousConversationId = useRef<string | null>(null);
  const activeConversationId = useRef(conversationId);
  const previousItemCount = useRef(0);
  const loading = useRef(false);
  const followLatest = useRef(true);
  activeConversationId.current = conversationId;

  useLayoutEffect(() => {
    if (!scrollRequest) return;
    const element = findMessageElement(
      viewport.current,
      scrollRequest.messageId,
      scrollRequest.messageSequence,
    );
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [messages, scrollRequest]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (previousConversationId.current !== conversationId) {
      previousConversationId.current = conversationId;
      previousItemCount.current = messages.length + subagents.length;
      element.scrollTop = element.scrollHeight;
      followLatest.current = true;
      return;
    }
    const nextCount = messages.length + subagents.length;
    const appended = nextCount > previousItemCount.current;
    previousItemCount.current = nextCount;
    if (appended && followLatest.current) {
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    }
  }, [conversationId, messages, subagents]);

  useEffect(() => {
    const root = viewport.current;
    const sentinel = topSentinel.current;
    if (!root || !sentinel || !hasMoreHistory) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loading.current || loadingEarlier) {
          return;
        }
        loading.current = true;
        const requestedConversationId = conversationId;
        const previousHeight = root.scrollHeight;
        const previousTop = root.scrollTop;
        void onLoadEarlier().finally(() => {
          requestAnimationFrame(() => {
            if (activeConversationId.current !== requestedConversationId) {
              loading.current = false;
              return;
            }
            root.scrollTop = previousTop + root.scrollHeight - previousHeight;
            loading.current = false;
          });
        });
      },
      { root, rootMargin: "120px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [conversationId, hasMoreHistory, loadingEarlier, onLoadEarlier]);

  function updateVisibleUserMessage() {
    const root = viewport.current;
    if (!root) return;
    followLatest.current = isNearBottom(root);
    const rootTop = root.getBoundingClientRect().top;
    let nearest: {
      readonly id: string;
      readonly sequence?: number;
      readonly distance: number;
    } | null = null;
    for (const element of root.querySelectorAll<HTMLElement>(
      "[data-user-message='true']",
    )) {
      const id = element.dataset.messageId;
      if (!id) continue;
      const rawSequence = element.dataset.messageSequence;
      const sequence = rawSequence ? Number(rawSequence) : undefined;
      const distance = Math.abs(
        element.getBoundingClientRect().top - rootTop - 80,
      );
      if (!nearest || distance < nearest.distance) {
        nearest = {
          id,
          ...(Number.isSafeInteger(sequence) ? { sequence } : {}),
          distance,
        };
      }
    }
    onVisibleUserMessageChange(
      nearest ? { id: nearest.id, sequence: nearest.sequence } : null,
    );
  }

  const timeline = createTimeline(messages, subagents);
  return (
    <div
      className={styles.messages}
      onScroll={updateVisibleUserMessage}
      ref={viewport}
    >
      <div ref={topSentinel} />
      {loadingEarlier ? (
        <p className={styles.historyLoading}>正在加载更早消息</p>
      ) : null}
      {timeline.length === 0 ? (
        <div className={styles.emptyState}>
          <Bot aria-hidden="true" size={26} />
          <strong>主 Agent</strong>
        </div>
      ) : (
        timeline.map((item) =>
          item.kind === "message" ? (
            <ChatMessageView
              key={`message:${item.message.id}`}
              message={item.message}
            />
          ) : (
            <div
              className={styles.subagentTimelineItem}
              key={`subagent:${item.subagent.conversationId}`}
            >
              <SubagentCard onOpen={onOpenSubagent} subagent={item.subagent} />
            </div>
          ),
        )
      )}
    </div>
  );
}

function ChatMessageView({ message }: { readonly message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <article
      className={styles.message}
      data-message-id={message.id}
      data-message-sequence={message.sequence}
      data-role={message.role}
      data-user-message={message.role === "user" ? "true" : undefined}
    >
      <span className={styles.messageAvatar}>
        {message.role === "assistant" || message.role === "delegation" ? (
          <Bot aria-hidden="true" size={16} />
        ) : (
          <UserRound aria-hidden="true" size={16} />
        )}
      </span>
      <div className={styles.messageBody}>
        {message.role === "delegation" ? (
          <small className={styles.delegationLabel}>主 Agent 委派</small>
        ) : null}
        <MarkdownContent complete={message.complete} markdown={message.text} />
        {!message.complete ? <span className={styles.streamingCursor} /> : null}
      </div>
      <button
        aria-label="复制消息"
        className={styles.copyButton}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(message.text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
        title="复制消息"
        type="button"
      >
        {copied ? (
          <Check aria-hidden="true" size={14} />
        ) : (
          <Copy aria-hidden="true" size={14} />
        )}
      </button>
    </article>
  );
}

type TimelineItem =
  | {
      readonly kind: "message";
      readonly message: ChatMessage;
      readonly order: number;
    }
  | {
      readonly kind: "subagent";
      readonly subagent: ConversationSubagent;
      readonly order: number;
    };

function createTimeline(
  messages: readonly ChatMessage[],
  subagents: readonly ConversationSubagent[],
): TimelineItem[] {
  return [
    ...messages.map((message, index) => ({
      kind: "message" as const,
      message,
      order: eventOrder(message.createdAt, index),
    })),
    ...subagents.map((subagent, index) => ({
      kind: "subagent" as const,
      subagent,
      order: eventOrder(subagent.createdAt, messages.length + index),
    })),
  ].sort((left, right) => left.order - right.order);
}

function eventOrder(value: string | undefined, fallback: number): number {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 160;
}

function findMessageElement(
  root: HTMLElement | null,
  messageId: string,
  messageSequence: number,
): HTMLElement | null {
  if (!root) return null;
  for (const element of root.querySelectorAll<HTMLElement>("[data-message-id]")) {
    if (
      element.dataset.messageId === messageId ||
      (element.dataset.role === "user" &&
        element.dataset.messageSequence === String(messageSequence))
    ) {
      return element;
    }
  }
  return null;
}
