"use client";

import {
  Bot,
  Check,
  Copy,
  MessageSquarePlus,
  PanelRightOpen,
  RotateCcw,
  Send,
  Square,
  UserRound,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ExecutionDetails } from "./execution-details";
import { MarkdownContent } from "./markdown-content";
import {
  useChatConversation,
  type ChatMessage,
} from "./use-chat-conversation";
import styles from "./chat-workspace.module.css";

export function ChatWorkspace({
  authorizationToken,
  compact = false,
  contextWindowTokens = null,
  displayName,
  enableExecutionDetails = false,
  modelAvailable = null,
  onAuthenticationExpired,
}: {
  readonly authorizationToken?: string;
  readonly compact?: boolean;
  readonly contextWindowTokens?: number | null;
  readonly displayName: string;
  readonly enableExecutionDetails?: boolean;
  readonly modelAvailable?: boolean | null;
  readonly onAuthenticationExpired?: () => void;
}) {
  const layout = useRef<HTMLDivElement | null>(null);
  const messagesEnd = useRef<HTMLDivElement | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState(420);
  const conversation = useChatConversation({
    authorizationToken,
    modelAvailable,
    onAuthenticationExpired,
  });

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation.messages]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void conversation.sendMessage(conversation.message);
  }

  function submitWithKeyboard(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const disabled =
    conversation.busy || conversation.terminal || modelAvailable === false;
  const executionAuthenticationExpired =
    onAuthenticationExpired ?? redirectToLogin;
  const layoutStyle = {
    "--execution-width": `${detailsWidth}px`,
  } as CSSProperties;

  return (
    <div
      className={`${styles.chatLayout} ${detailsOpen ? styles.detailsOpen : ""}`}
      ref={layout}
      style={layoutStyle}
    >
      <section
        className={`${styles.workspace} ${compact ? styles.compact : ""}`}
        aria-label="主 Agent 对话"
      >
        <header className={styles.header}>
          <div className={styles.agentIdentity}>
            <span className={styles.agentIcon}>
              <Bot aria-hidden="true" size={18} />
            </span>
            <span>
              <strong>主 Agent</strong>
              <small>
                {displayName} · {statusLabel(conversation.status, conversation.busy)}
              </small>
              <small>{formatContextWindow(contextWindowTokens)}</small>
            </span>
          </div>
          <div className={styles.headerActions}>
            {enableExecutionDetails ? (
              <button
                aria-label="执行详情"
                aria-pressed={detailsOpen}
                className={styles.iconButton}
                disabled={!conversation.conversationId}
                onClick={() => setDetailsOpen((open) => !open)}
                title="执行详情"
                type="button"
              >
                <PanelRightOpen aria-hidden="true" size={18} />
              </button>
            ) : null}
            <button
              aria-label="新对话"
              className={styles.iconButton}
              disabled={conversation.busy}
              onClick={() => {
                setDetailsOpen(false);
                conversation.newConversation();
              }}
              title="新对话"
              type="button"
            >
              <MessageSquarePlus aria-hidden="true" size={18} />
            </button>
          </div>
        </header>
        <div className={styles.messages} aria-live="polite">
          {conversation.messages.length === 0 ? (
            <div className={styles.emptyState}>
              <Bot aria-hidden="true" size={26} />
              <strong>主 Agent</strong>
            </div>
          ) : (
            conversation.messages.map((item) => (
              <ChatMessageView key={item.id} message={item} />
            ))
          )}
          <div ref={messagesEnd} />
        </div>
        <div className={styles.composerArea}>
          {modelAvailable === false ? (
            <p className={styles.error} role="status">
              尚未配置可用模型。
            </p>
          ) : conversation.error ? (
            <div className={styles.errorRow} role="alert">
              <p className={styles.error}>{conversation.error}</p>
              {conversation.failedMessage ? (
                <button
                  aria-label="重新发送"
                  className={styles.retryButton}
                  disabled={conversation.busy}
                  onClick={() => void conversation.retryFailedMessage()}
                  title="重新发送"
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={15} />
                </button>
              ) : null}
            </div>
          ) : null}
          {conversation.reconnecting ? (
            <p className={styles.connectionStatus} role="status">
              连接中断，正在重连...
            </p>
          ) : null}
          <form className={styles.composer} onSubmit={submit}>
            <textarea
              aria-label="消息"
              disabled={modelAvailable === false || conversation.terminal}
              onChange={(event) => {
                const nextMessage = event.target.value;
                conversation.updateMessage(nextMessage);
              }}
              onKeyDown={submitWithKeyboard}
              rows={2}
              value={conversation.message}
            />
            {conversation.busy ? (
              <button
                aria-label="停止生成"
                className={styles.sendButton}
                disabled={!conversation.cancellable}
                onClick={conversation.cancel}
                title="停止生成"
                type="button"
              >
                <Square aria-hidden="true" fill="currentColor" size={14} />
              </button>
            ) : (
              <button
                aria-label="发送消息"
                className={styles.sendButton}
                disabled={disabled || !conversation.message.trim()}
                title="发送消息"
                type="submit"
              >
                <Send aria-hidden="true" size={17} />
              </button>
            )}
          </form>
          <span className={styles.characterCount}>
            {Array.from(conversation.message).length}/32000
          </span>
        </div>
      </section>
      {detailsOpen && conversation.conversationId ? (
        <>
          <div
            aria-label="调整执行详情宽度"
            aria-orientation="vertical"
            className={styles.executionResizer}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                return;
              }
              event.preventDefault();
              setDetailsWidth((width) =>
                clampDetailsWidth(
                  width + (event.key === "ArrowLeft" ? 24 : -24),
                ),
              );
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const right = layout.current?.getBoundingClientRect().right;
              if (right !== undefined) {
                setDetailsWidth(clampDetailsWidth(right - event.clientX));
              }
            }}
            role="separator"
            tabIndex={0}
          />
          <ExecutionDetails
            conversationId={conversation.conversationId}
            onAuthenticationExpired={executionAuthenticationExpired}
            onClose={() => setDetailsOpen(false)}
          />
        </>
      ) : null}
    </div>
  );
}

function clampDetailsWidth(value: number): number {
  return Math.min(720, Math.max(300, value));
}

function redirectToLogin(): void {
  window.location.assign("/login");
}

function formatContextWindow(value: number | null): string {
  return value === null
    ? "上下文窗口未配置"
    : `上下文窗口 ${value.toLocaleString("zh-CN")} Token`;
}

function ChatMessageView({ message }: { readonly message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <article className={styles.message} data-role={message.role}>
      <span className={styles.messageAvatar}>
        {message.role === "assistant" ? (
          <Bot aria-hidden="true" size={16} />
        ) : (
          <UserRound aria-hidden="true" size={16} />
        )}
      </span>
      <div className={styles.messageBody}>
        <MarkdownContent markdown={message.text} />
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

function statusLabel(
  status: ReturnType<typeof useChatConversation>["status"],
  busy: boolean,
): string {
  if (status === "CANCELLING") return "正在停止";
  if (busy) return "正在回复";
  if (status === "TERMINAL_FAILED") return "会话不可用";
  if (status === "TERMINAL_COMPLETED") return "会话已结束";
  return "就绪";
}
