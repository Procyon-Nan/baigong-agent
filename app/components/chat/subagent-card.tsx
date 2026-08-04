"use client";

import { Bot, ChevronRight } from "lucide-react";
import type { ConversationSubagent } from "./conversation-data-protocol";
import styles from "./conversation-history.module.css";

export function SubagentCard({
  onOpen,
  subagent,
}: {
  readonly onOpen: (conversationId: string) => void;
  readonly subagent: ConversationSubagent;
}) {
  const verified = subagent.linkStatus === "VERIFIED";
  return (
    <article className={styles.subagentCard}>
      <span className={styles.subagentIcon}>
        <Bot aria-hidden="true" size={16} />
      </span>
      <div>
        <strong>{subagent.name}</strong>
        <small>{subagentStatusLabel(subagent)}</small>
      </div>
      <button
        aria-label={`打开 ${subagent.name} 会话`}
        disabled={!verified}
        onClick={() => onOpen(subagent.conversationId)}
        title={verified ? "打开 Subagent 会话" : "正在验证会话关系"}
        type="button"
      >
        <ChevronRight aria-hidden="true" size={17} />
      </button>
    </article>
  );
}

function subagentStatusLabel(subagent: ConversationSubagent): string {
  if (subagent.linkStatus === "PENDING") return "正在验证会话关系";
  if (subagent.status === "RUNNING" || subagent.status === "STARTING") {
    return "正在执行";
  }
  if (subagent.status === "CANCELLING") return "正在停止";
  if (subagent.status === "TERMINAL_COMPLETED") return "已完成";
  if (subagent.status === "TERMINAL_FAILED") return "执行失败";
  return "等待输入";
}
