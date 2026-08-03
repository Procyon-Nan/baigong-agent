import { describe, expect, it } from "vitest";
import {
  assistantMessageBlockId,
  userMessageBlockId,
} from "@/src/server/conversations/message-identifiers";
import { deriveConversationTitle } from "@/src/server/conversations/message-title";

describe("conversation message persistence helpers", () => {
  it("derives a compact plain-text title from the first user message", () => {
    expect(
      deriveConversationTitle(
        "# **部署说明**\n\n请查看 [运行手册](https://example.com) 和 `配置`。",
      ),
    ).toBe("部署说明 请查看 运行手册 和 配置 。");
    expect(deriveConversationTitle("`***`")).toBe("新对话");
    expect(Array.from(deriveConversationTitle("你".repeat(80)))).toHaveLength(
      60,
    );
  });

  it("creates stable message block ids without merging assistant steps", () => {
    const conversationId = "conversation";
    const turnId = "turn";

    expect(userMessageBlockId(conversationId, turnId)).toBe(
      userMessageBlockId(conversationId, turnId),
    );
    expect(assistantMessageBlockId(conversationId, turnId, 0)).toBe(
      assistantMessageBlockId(conversationId, turnId, 0),
    );
    expect(assistantMessageBlockId(conversationId, turnId, 0)).not.toBe(
      assistantMessageBlockId(conversationId, turnId, 1),
    );
    expect(userMessageBlockId(conversationId, turnId)).not.toBe(
      assistantMessageBlockId(conversationId, turnId, 0),
    );
  });
});
