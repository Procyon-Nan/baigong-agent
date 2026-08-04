"use client";

import {
  Bot,
  ChevronLeft,
  Menu,
  MessageSquarePlus,
  PanelRightOpen,
  RotateCcw,
  Send,
  Square,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ConversationHistory } from "./conversation-history";
import { ConversationRail } from "./conversation-rail";
import { ConversationSidebar } from "./conversation-sidebar";
import { ExecutionDetails } from "./execution-details";
import { useChatConversation } from "./use-chat-conversation";
import { useConversationList } from "./use-conversation-list";
import { useConversationNodes } from "./use-conversation-nodes";
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
  const initialConversationResolved = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState(420);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [scrollRequest, setScrollRequest] = useState<{
    readonly messageId: string;
    readonly messageSequence: number;
    readonly sequence: number;
  } | null>(null);
  const handleAuthenticationExpired = useCallback(
    (_message?: string) => {
      if (onAuthenticationExpired) onAuthenticationExpired();
      else redirectToLogin();
    },
    [onAuthenticationExpired],
  );
  const conversation = useChatConversation({
    authorizationToken,
    modelAvailable,
    onAuthenticationExpired: handleAuthenticationExpired,
  });
  const conversationList = useConversationList({
    authorizationToken,
    onAuthenticationExpired: handleAuthenticationExpired,
  });
  const nodes = useConversationNodes({
    authorizationToken,
    conversationId: conversation.conversationId,
    refreshKey: conversation.historyRevision,
    onAuthenticationExpired: handleAuthenticationExpired,
  });
  const selectConversationRef = useRef(conversation.selectConversation);
  selectConversationRef.current = conversation.selectConversation;

  useEffect(() => {
    if (
      initialConversationResolved.current ||
      conversationList.loading ||
      conversationList.archived
    ) {
      return;
    }
    initialConversationResolved.current = true;
    const recent = conversationList.items[0];
    if (recent) void selectConversationRef.current(recent.id);
  }, [
    conversationList.archived,
    conversationList.items,
    conversationList.loading,
  ]);

  useEffect(() => {
    if (conversation.conversationId) void conversationList.refresh();
  }, [
    conversation.conversationId,
    conversation.historyRevision,
    conversationList.refresh,
  ]);

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

  function startNewConversation() {
    setDetailsOpen(false);
    setSidebarOpen(false);
    setActiveNodeId(null);
    setScrollRequest(null);
    conversation.newConversation();
  }

  async function selectConversation(conversationId: string) {
    setSidebarOpen(false);
    setDetailsOpen(false);
    setActiveNodeId(null);
    setScrollRequest(null);
    await conversation.selectConversation(conversationId);
  }

  const disabled =
    conversation.busy ||
    conversation.terminal ||
    conversation.readOnly ||
    conversation.selecting ||
    modelAvailable === false;
  const layoutStyle = {
    "--execution-width": `${detailsWidth}px`,
  } as CSSProperties;
  const error = conversation.error || conversationList.error || nodes.error;

  return (
    <div
      className={`${styles.chatShell} ${compact ? styles.compactShell : ""}`}
    >
      <ConversationSidebar
        archived={conversationList.archived}
        hasMore={conversationList.hasMore}
        items={conversationList.items}
        loading={conversationList.loading}
        onArchive={async (conversationId) => {
          const archived = await conversationList.archive(conversationId);
          if (archived && conversationId === conversation.conversationId) {
            startNewConversation();
          }
          return archived;
        }}
        onClose={() => setSidebarOpen(false)}
        onLoadMore={conversationList.loadMore}
        onNewConversation={startNewConversation}
        onRename={conversationList.rename}
        onRestore={conversationList.restore}
        onSelect={(conversationId) => void selectConversation(conversationId)}
        onViewChange={conversationList.setArchived}
        open={sidebarOpen}
        overlay={compact}
        selectedConversationId={conversation.conversationId}
      />
      <div
        className={`${styles.chatLayout} ${detailsOpen ? styles.detailsOpen : ""}`}
        ref={layout}
        style={layoutStyle}
      >
        <section
          className={`${styles.workspace} ${compact ? styles.compact : ""}`}
          aria-label="Agent 对话"
        >
          <header className={styles.header}>
            <div className={styles.agentIdentity}>
              <button
                aria-label="会话列表"
                className={`${styles.iconButton} ${styles.sidebarToggleButton}`}
                onClick={() => setSidebarOpen(true)}
                title="会话列表"
                type="button"
              >
                <Menu aria-hidden="true" size={18} />
              </button>
              {conversation.conversationContext?.parentConversationId ? (
                <button
                  aria-label="返回父会话"
                  className={styles.iconButton}
                  onClick={() =>
                    void selectConversation(
                      conversation.conversationContext!.parentConversationId!,
                    )
                  }
                  title="返回父会话"
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={18} />
                </button>
              ) : null}
              <span className={styles.agentIcon}>
                <Bot aria-hidden="true" size={18} />
              </span>
              <span className={styles.agentText}>
                <strong>
                  {conversation.conversationContext?.subagentName ??
                    conversation.conversationTitle}
                </strong>
                <small>
                  {displayName} · {statusLabel(conversation)}
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
                onClick={startNewConversation}
                title="新对话"
                type="button"
              >
                <MessageSquarePlus aria-hidden="true" size={18} />
              </button>
            </div>
          </header>
          <div
            className={`${styles.conversationBody} ${nodes.nodes.length === 0 ? styles.conversationBodyWithoutRail : ""}`}
          >
            <ConversationRail
              activeNodeId={activeNodeId}
              nodes={nodes.nodes}
              onSelect={(node) => {
                void conversation
                  .revealMessage(node.id, node.sequence)
                  .then((found) => {
                    if (!found) return;
                    setActiveNodeId(node.id);
                    setScrollRequest((current) => ({
                      messageId: node.id,
                      messageSequence: node.sequence,
                      sequence: (current?.sequence ?? 0) + 1,
                    }));
                  });
              }}
            />
            <ConversationHistory
              conversationId={conversation.conversationId}
              hasMoreHistory={conversation.hasMoreHistory}
              loadingEarlier={conversation.loadingEarlier}
              messages={conversation.messages}
              onLoadEarlier={conversation.loadEarlierMessages}
              onOpenSubagent={(conversationId) =>
                void selectConversation(conversationId)
              }
              onVisibleUserMessageChange={(message) => {
                if (!message) {
                  setActiveNodeId(null);
                  return;
                }
                const node = nodes.nodes.find(
                  (candidate) =>
                    candidate.id === message.id ||
                    candidate.sequence === message.sequence,
                );
                setActiveNodeId(node?.id ?? null);
              }}
              scrollRequest={scrollRequest}
              subagents={conversation.subagents}
            />
          </div>
          <div className={styles.composerArea}>
            {modelAvailable === false ? (
              <p className={styles.error} role="status">
                尚未配置可用模型。
              </p>
            ) : error ? (
              <div className={styles.errorRow} role="alert">
                <p className={styles.error}>{error}</p>
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
                disabled={
                  modelAvailable === false ||
                  conversation.terminal ||
                  conversation.readOnly ||
                  conversation.selecting
                }
                onChange={(event) =>
                  conversation.updateMessage(event.target.value)
                }
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
              onAuthenticationExpired={handleAuthenticationExpired}
              onClose={() => setDetailsOpen(false)}
            />
          </>
        ) : null}
      </div>
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

function statusLabel(conversation: ReturnType<typeof useChatConversation>): string {
  if (conversation.selecting) return "正在载入";
  if (conversation.readOnly) return "只读";
  if (conversation.status === "CANCELLING") return "正在停止";
  if (conversation.busy) return "正在回复";
  if (conversation.status === "TERMINAL_FAILED") return "会话不可用";
  if (conversation.status === "TERMINAL_COMPLETED") return "会话已结束";
  return "就绪";
}
