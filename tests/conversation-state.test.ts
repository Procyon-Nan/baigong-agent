import { describe, expect, it } from "vitest";
import {
  conversationStateReducer,
  createInitialConversationState,
} from "@/app/components/chat/conversation-state";
import type { ConversationSnapshot } from "@/app/components/chat/conversation-data-protocol";

const timestamp = "2026-08-04T08:00:00.000Z";

describe("conversation state", () => {
  it("applies a snapshot as one complete state transition", () => {
    const state = conversationStateReducer(createInitialConversationState(), {
      type: "snapshot.applied",
      snapshot: snapshot(),
      messages: [
        {
          id: "message-1",
          role: "user",
          text: "问题",
          complete: true,
          createdAt: timestamp,
          sequence: 1,
        },
      ],
    });

    expect(state).toMatchObject({
      conversationId: "conversation-1",
      conversationTitle: "测试会话",
      activeTurnId: "turn-1",
      busy: true,
      selecting: false,
      hasMoreHistory: true,
      error: "",
    });
    expect(state.messages).toHaveLength(1);
  });

  it("uses the authoritative event time for assistant messages", () => {
    const state = conversationStateReducer(createInitialConversationState(), {
      type: "public-event.received",
      failedMessage: "",
      event: {
        type: "assistant.completed",
        conversationId: "conversation-1",
        cursor: 2,
        at: timestamp,
        data: {
          turnId: "turn-1",
          blockId: "assistant-1",
          text: "回答",
        },
      },
    });

    expect(state.messages).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        text: "回答",
        complete: true,
        createdAt: timestamp,
      },
    ]);
  });

  it("restores and updates durable todo and question state", () => {
    const loaded = conversationStateReducer(createInitialConversationState(), {
      type: "snapshot.applied",
      snapshot: {
        ...snapshot(),
        uiState: {
          todos: [{ content: "读取资料", priority: "high", status: "pending" }],
          pendingInput: null,
        },
      },
      messages: [],
    });
    const asked = conversationStateReducer(loaded, {
      type: "public-event.received",
      failedMessage: "",
      event: {
        type: "input.requested",
        conversationId: "conversation-1",
        cursor: 4,
        at: timestamp,
        data: {
          origin: "MAIN",
          requests: [
            {
              requestId: "request-1",
              prompt: "继续吗？",
              display: "confirmation",
              allowFreeform: false,
              options: [
                {
                  id: "yes",
                  label: "继续",
                  description: null,
                  style: "primary",
                },
              ],
            },
          ],
        },
      },
    });
    const updated = conversationStateReducer(asked, {
      type: "public-event.received",
      failedMessage: "",
      event: {
        type: "todo.updated",
        conversationId: "conversation-1",
        cursor: 5,
        at: timestamp,
        data: {
          items: [
            { content: "读取资料", priority: "high", status: "completed" },
          ],
        },
      },
    });
    const parked = conversationStateReducer(updated, {
      type: "public-event.received",
      failedMessage: "",
      event: {
        type: "turn.completed",
        conversationId: "conversation-1",
        cursor: 6,
        at: timestamp,
        data: { turnId: "turn-1" },
      },
    });
    const waiting = conversationStateReducer(parked, {
      type: "public-event.received",
      failedMessage: "",
      event: {
        type: "conversation.status",
        conversationId: "conversation-1",
        cursor: 7,
        at: timestamp,
        data: { status: "WAITING" },
      },
    });

    expect(asked.pendingInput?.requests[0]?.prompt).toBe("继续吗？");
    expect(updated.todos[0]?.status).toBe("completed");
    expect(waiting.pendingInput?.requests[0]?.prompt).toBe("继续吗？");
    expect(
      conversationStateReducer(waiting, { type: "submission.started" })
        .pendingInput,
    ).toBeNull();
  });

  it("does not duplicate a completed reply replayed across the snapshot boundary", () => {
    const loaded = conversationStateReducer(createInitialConversationState(), {
      type: "snapshot.applied",
      snapshot: snapshot(),
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "已持久化回答",
          complete: true,
          createdAt: timestamp,
          sequence: 2,
        },
      ],
    });
    const replayed = conversationStateReducer(loaded, {
      type: "public-event.received",
      failedMessage: "",
      event: assistantCompletedEvent("已持久化回答", 2),
    });

    expect(replayed.messages).toEqual(loaded.messages);
  });

  it("applies the first live reply after a loaded snapshot without losing text", () => {
    const loaded = conversationStateReducer(createInitialConversationState(), {
      type: "snapshot.applied",
      snapshot: snapshot(),
      messages: [],
    });
    const streaming = conversationStateReducer(loaded, {
      type: "public-event.received",
      failedMessage: "",
      event: {
        type: "assistant.delta",
        conversationId: "conversation-1",
        cursor: 2,
        at: timestamp,
        data: {
          turnId: "turn-1",
          blockId: "assistant-1",
          delta: "新回答",
          text: "新回答",
        },
      },
    });
    const completed = conversationStateReducer(streaming, {
      type: "public-event.received",
      failedMessage: "",
      event: assistantCompletedEvent("新回答完成", 3),
    });

    expect(completed.messages).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        text: "新回答完成",
        complete: true,
        createdAt: timestamp,
      },
    ]);
  });

  it("restores the previous status when cancellation fails", () => {
    const running = {
      ...createInitialConversationState(),
      status: "RUNNING" as const,
    };
    const cancelling = conversationStateReducer(running, {
      type: "cancel.requested",
    });
    const failed = conversationStateReducer(cancelling, {
      type: "cancel.failed",
      previousStatus: running.status,
      error: "取消失败",
    });

    expect(cancelling.status).toBe("CANCELLING");
    expect(failed).toMatchObject({ status: "RUNNING", error: "取消失败" });
  });

  it("ignores delayed boundaries from an older turn while reconnecting", () => {
    const running = conversationStateReducer(createInitialConversationState(), {
      type: "snapshot.applied",
      snapshot: snapshot(),
      messages: [],
    });
    const delayedCancellation = conversationStateReducer(running, {
      type: "public-event.received",
      failedMessage: "older message",
      event: {
        type: "turn.cancelled",
        conversationId: "conversation-1",
        cursor: 2,
        at: timestamp,
        data: { turnId: "older-turn" },
      },
    });
    const delayedWaiting = conversationStateReducer(delayedCancellation, {
      type: "public-event.received",
      failedMessage: "",
      event: {
        type: "conversation.status",
        conversationId: "conversation-1",
        cursor: 3,
        at: timestamp,
        data: { status: "WAITING" },
      },
    });

    expect(delayedWaiting).toMatchObject({
      activeTurnId: "turn-1",
      status: "RUNNING",
      busy: true,
      error: "",
    });
  });

  it("restores busy state when a replayed turn start follows an old wait", () => {
    const waiting = {
      ...createInitialConversationState(),
      conversationId: "conversation-1",
      status: "WAITING" as const,
    };
    const started = conversationStateReducer(waiting, {
      type: "public-event.received",
      failedMessage: "",
      event: {
        type: "turn.started",
        conversationId: "conversation-1",
        cursor: 4,
        at: timestamp,
        data: { turnId: "turn-2" },
      },
    });

    expect(started).toMatchObject({
      activeTurnId: "turn-2",
      status: "RUNNING",
      busy: true,
    });
  });

  it("resets transient and persisted conversation state together", () => {
    const dirty = {
      ...createInitialConversationState(),
      conversationId: "conversation-1",
      busy: true,
      selecting: true,
      loadingEarlier: true,
      reconnecting: true,
      error: "错误",
    };

    expect(conversationStateReducer(dirty, { type: "reset" })).toEqual(
      createInitialConversationState(),
    );
  });
});

function snapshot(): ConversationSnapshot {
  return {
    conversation: {
      id: "conversation-1",
      title: "测试会话",
      status: "RUNNING",
      activeTurn: { id: "turn-1", status: "RUNNING" },
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    context: {
      kind: "MAIN",
      parentConversationId: null,
      subagentName: null,
      linkStatus: "NOT_APPLICABLE",
    },
    messages: { items: [], nextCursor: "older" },
    lastEveCursor: 1,
    subagents: [],
    uiState: { todos: [], pendingInput: null },
  };
}

function assistantCompletedEvent(text: string, cursor: number) {
  return {
    type: "assistant.completed" as const,
    conversationId: "conversation-1",
    cursor,
    at: timestamp,
    data: {
      turnId: "turn-1",
      blockId: "assistant-1",
      text,
    },
  };
}
