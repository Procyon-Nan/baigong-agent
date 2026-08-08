import type { ConversationHistoryMessage } from "./conversation-data-protocol";
import type { ChatMessage } from "./message-state";

export function fromConversationHistoryMessage(
  message: ConversationHistoryMessage,
): ChatMessage {
  return {
    id: message.id,
    role:
      message.role === "USER"
        ? "user"
        : message.role === "ASSISTANT"
          ? "assistant"
          : "delegation",
    text: message.body,
    complete: message.status !== "STREAMING",
    createdAt: message.createdAt,
    sequence: message.sequence,
    attachments: message.attachments,
  };
}
