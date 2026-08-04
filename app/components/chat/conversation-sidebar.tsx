"use client";

import {
  Archive,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ConversationSummary } from "./conversation-data-protocol";
import styles from "./conversation-sidebar.module.css";

export function ConversationSidebar({
  archived,
  hasMore,
  items,
  loading,
  onArchive,
  onClose,
  onLoadMore,
  onNewConversation,
  onRename,
  onRestore,
  onSelect,
  onViewChange,
  open,
  overlay = false,
  selectedConversationId,
}: {
  readonly archived: boolean;
  readonly hasMore: boolean;
  readonly items: readonly ConversationSummary[];
  readonly loading: boolean;
  readonly onArchive: (conversationId: string) => Promise<boolean>;
  readonly onClose: () => void;
  readonly onLoadMore: () => Promise<void>;
  readonly onNewConversation: () => void;
  readonly onRename: (conversationId: string, title: string) => Promise<boolean>;
  readonly onRestore: (conversationId: string) => Promise<boolean>;
  readonly onSelect: (conversationId: string) => void;
  readonly onViewChange: (archived: boolean) => void;
  readonly open: boolean;
  readonly overlay?: boolean;
  readonly selectedConversationId: string | null;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <aside
      aria-label="会话列表"
      className={`${styles.conversationSidebar} ${overlay ? styles.overlaySidebar : ""} ${open ? styles.conversationSidebarOpen : ""}`}
    >
      <header className={styles.sidebarHeader}>
        <strong>会话</strong>
        <div className={styles.sidebarHeaderActions}>
          <button
            aria-label="新对话"
            className={styles.detailIconButton}
            onClick={onNewConversation}
            title="新对话"
            type="button"
          >
            <MessageSquarePlus aria-hidden="true" size={17} />
          </button>
          <button
            aria-label="关闭会话列表"
            className={`${styles.detailIconButton} ${styles.sidebarCloseButton}`}
            onClick={onClose}
            title="关闭会话列表"
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      </header>
      <div className={styles.conversationTabs} role="tablist">
        <button
          aria-selected={!archived}
          className={!archived ? styles.activeConversationTab : ""}
          onClick={() => onViewChange(false)}
          role="tab"
          type="button"
        >
          进行中
        </button>
        <button
          aria-selected={archived}
          className={archived ? styles.activeConversationTab : ""}
          onClick={() => onViewChange(true)}
          role="tab"
          type="button"
        >
          已归档
        </button>
      </div>
      <div className={styles.conversationList}>
        {items.length === 0 && !loading ? (
          <p className={styles.sidebarEmpty}>
            {archived ? "暂无已归档会话" : "暂无会话"}
          </p>
        ) : (
          items.map((conversation) =>
            editingId === conversation.id ? (
              <RenameConversationForm
                conversation={conversation}
                key={conversation.id}
                onCancel={() => setEditingId(null)}
                onRename={async (title) => {
                  if (await onRename(conversation.id, title)) {
                    setEditingId(null);
                  }
                }}
              />
            ) : (
              <div
                className={`${styles.conversationRow} ${selectedConversationId === conversation.id ? styles.activeConversationRow : ""}`}
                key={conversation.id}
              >
                <button
                  className={styles.conversationSelectButton}
                  onClick={() => onSelect(conversation.id)}
                  type="button"
                >
                  <strong>{conversation.title}</strong>
                  <small>{formatRelativeDate(conversation.updatedAt)}</small>
                </button>
                <div className={styles.conversationRowActions}>
                  {!archived ? (
                    <button
                      aria-label={`重命名 ${conversation.title}`}
                      className={styles.conversationActionButton}
                      onClick={() => setEditingId(conversation.id)}
                      title="重命名"
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={13} />
                    </button>
                  ) : null}
                  <button
                    aria-label={archived ? "恢复会话" : "归档会话"}
                    className={styles.conversationActionButton}
                    onClick={() =>
                      void (archived
                        ? onRestore(conversation.id)
                        : onArchive(conversation.id))
                    }
                    title={archived ? "恢复会话" : "归档会话"}
                    type="button"
                  >
                    {archived ? (
                      <RotateCcw aria-hidden="true" size={13} />
                    ) : (
                      <Archive aria-hidden="true" size={13} />
                    )}
                  </button>
                </div>
              </div>
            ),
          )
        )}
        {loading ? <p className={styles.sidebarEmpty}>正在加载</p> : null}
      </div>
      {hasMore ? (
        <button
          className={styles.loadMoreConversations}
          disabled={loading}
          onClick={() => void onLoadMore()}
          type="button"
        >
          加载更多
        </button>
      ) : null}
    </aside>
  );
}

function RenameConversationForm({
  conversation,
  onCancel,
  onRename,
}: {
  readonly conversation: ConversationSummary;
  readonly onCancel: () => void;
  readonly onRename: (title: string) => Promise<void>;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = new FormData(event.currentTarget).get("title");
    if (typeof title === "string" && title.trim()) {
      void onRename(title.trim());
    }
  }

  return (
    <form className={styles.renameConversationForm} onSubmit={submit}>
      <input
        aria-label="会话标题"
        autoFocus
        defaultValue={conversation.title}
        maxLength={240}
        name="title"
      />
      <button type="submit">保存</button>
      <button onClick={onCancel} type="button">
        取消
      </button>
    </form>
  );
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
