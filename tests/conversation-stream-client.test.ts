import { describe, expect, it } from "vitest";
import { shouldAcceptConversationEvent } from "@/app/components/chat/use-conversation-stream";
import type { PublicConversationEvent } from "@/app/components/chat/protocol";

describe("conversation stream client", () => {
  it("accepts only events after the snapshot cursor for the selected conversation", () => {
    expect(shouldAcceptConversationEvent(event(13), "conversation-1", 12)).toBe(
      true,
    );
    expect(shouldAcceptConversationEvent(event(12), "conversation-1", 12)).toBe(
      false,
    );
    expect(shouldAcceptConversationEvent(event(13), "conversation-2", 12)).toBe(
      false,
    );
  });

  it("keeps cursor-neutral control events visible", () => {
    expect(
      shouldAcceptConversationEvent(
        heartbeat(12),
        "conversation-1",
        12,
      ),
    ).toBe(true);
    expect(
      shouldAcceptConversationEvent(
        authenticationExpired(12),
        "conversation-1",
        12,
      ),
    ).toBe(true);
  });
});

function event(cursor: number): PublicConversationEvent {
  return {
    type: "assistant.delta",
    conversationId: "conversation-1",
    cursor,
    at: "2026-08-04T08:00:00.000Z",
    data: {
      turnId: "turn-1",
      blockId: "assistant-1",
      delta: "回答",
      text: "回答",
    },
  };
}

function heartbeat(cursor: number): PublicConversationEvent {
  return {
    type: "heartbeat",
    conversationId: "conversation-1",
    cursor,
    at: "2026-08-04T08:00:00.000Z",
    data: {},
  };
}

function authenticationExpired(cursor: number): PublicConversationEvent {
  return {
    type: "authentication.expired",
    conversationId: "conversation-1",
    cursor,
    at: "2026-08-04T08:00:00.000Z",
    data: {
      error: {
        code: "AUTHENTICATION_EXPIRED",
        message: "登录状态已失效。",
      },
    },
  };
}
