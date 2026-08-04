"use client";

import { ListTree, X } from "lucide-react";
import { useState } from "react";
import type { ConversationNode } from "./conversation-data-protocol";
import styles from "./conversation-rail.module.css";

export function ConversationRail({
  activeNodeId,
  nodes,
  onSelect,
}: {
  readonly activeNodeId: string | null;
  readonly nodes: readonly ConversationNode[];
  readonly onSelect: (node: ConversationNode) => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  if (nodes.length === 0) return null;

  return (
    <>
      <nav aria-label="用户消息位置" className={styles.conversationRail}>
        <span className={styles.railLine} />
        {nodes.map((node) => (
          <button
            aria-current={activeNodeId === node.id ? "location" : undefined}
            aria-label={node.summary}
            className={`${styles.railMarker} ${activeNodeId === node.id ? styles.activeRailMarker : ""}`}
            key={node.id}
            onClick={() => onSelect(node)}
            title={`${formatNodeTime(node.createdAt)} · ${node.summary}`}
            type="button"
          />
        ))}
      </nav>
      <button
        aria-label="用户消息位置"
        className={styles.mobileRailButton}
        onClick={() => setMobileOpen(true)}
        title="用户消息位置"
        type="button"
      >
        <ListTree aria-hidden="true" size={17} />
      </button>
      {mobileOpen ? (
        <div className={styles.mobileRailPanel}>
          <header>
            <strong>消息位置</strong>
            <button
              aria-label="关闭消息位置"
              className={styles.detailIconButton}
              onClick={() => setMobileOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={17} />
            </button>
          </header>
          <ol>
            {nodes.map((node) => (
              <li key={node.id}>
                <button
                  aria-current={activeNodeId === node.id ? "location" : undefined}
                  onClick={() => {
                    setMobileOpen(false);
                    onSelect(node);
                  }}
                  type="button"
                >
                  <span>{node.summary}</span>
                  <time dateTime={node.createdAt}>{formatNodeTime(node.createdAt)}</time>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </>
  );
}

function formatNodeTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
