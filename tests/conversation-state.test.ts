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
  };
}
