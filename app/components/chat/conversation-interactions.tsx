"use client";

import {
  Ban,
  CheckCircle2,
  Circle,
  CircleDot,
  ListChecks,
  MessageCircleQuestion,
} from "lucide-react";
import type {
  PublicPendingInput,
  PublicTodoItem,
} from "./protocol";
import styles from "./conversation-interactions.module.css";

export function ConversationInteractions({
  canRespond,
  onAnswer,
  pendingInput,
  todos,
}: {
  readonly canRespond: boolean;
  readonly onAnswer: (answer: string) => Promise<boolean>;
  readonly pendingInput: PublicPendingInput | null;
  readonly todos: readonly PublicTodoItem[];
}) {
  if (!pendingInput && todos.length === 0) return null;

  return (
    <div className={styles.interactions}>
      {todos.length > 0 ? <TodoList items={todos} /> : null}
      {pendingInput ? (
        <section className={styles.questionPanel} aria-live="polite">
          <header>
            <MessageCircleQuestion aria-hidden="true" size={16} />
            <strong>Agent 需要你的回答</strong>
            {pendingInput.origin === "SUBAGENT" ? (
              <span>来自 Subagent</span>
            ) : null}
          </header>
          <div className={styles.questionList}>
            {pendingInput.requests.map((request) => (
              <article className={styles.question} key={request.requestId}>
                <p>{request.prompt}</p>
                {request.options.length > 0 ? (
                  <div className={styles.options}>
                    {request.options.map((option) => (
                      <button
                        className={optionClassName(option.style)}
                        disabled={!canRespond}
                        key={option.id}
                        onClick={() => void onAnswer(option.label)}
                        title={option.description ?? undefined}
                        type="button"
                      >
                        <strong>{option.label}</strong>
                        {option.description ? (
                          <small>{option.description}</small>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                {request.allowFreeform ? (
                  <small className={styles.freeformHint}>
                    也可以在下方输入框中自由回答。
                  </small>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TodoList({ items }: { readonly items: readonly PublicTodoItem[] }) {
  const completed = items.filter(({ status }) => status === "completed").length;
  return (
    <details className={styles.todoPanel} open>
      <summary>
        <ListChecks aria-hidden="true" size={16} />
        <strong>任务进度</strong>
        <span>
          {completed}/{items.length} 已完成
        </span>
      </summary>
      <ol>
        {items.map((item, index) => (
          <li key={`${index}:${item.content}`}>
            <TodoStatusIcon status={item.status} />
            <span>{item.content}</span>
            <small>{priorityLabel(item.priority)}</small>
          </li>
        ))}
      </ol>
    </details>
  );
}

function TodoStatusIcon({
  status,
}: {
  readonly status: PublicTodoItem["status"];
}) {
  switch (status) {
    case "completed":
      return (
        <CheckCircle2
          aria-label="已完成"
          className={styles.completed}
          size={15}
        />
      );
    case "in_progress":
      return (
        <CircleDot
          aria-label="进行中"
          className={styles.inProgress}
          size={15}
        />
      );
    case "cancelled":
      return (
        <Ban aria-label="已取消" className={styles.cancelled} size={15} />
      );
    case "pending":
      return (
        <Circle aria-label="待处理" className={styles.pending} size={15} />
      );
  }
}

function optionClassName(style: "default" | "primary" | "danger" | null) {
  if (style === "primary") return styles.primaryOption;
  if (style === "danger") return styles.dangerOption;
  return styles.option;
}

function priorityLabel(priority: PublicTodoItem["priority"]): string {
  if (priority === "high") return "高";
  if (priority === "low") return "低";
  return "中";
}
