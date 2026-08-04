export type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant" | "delegation";
  readonly text: string;
  readonly complete: boolean;
  readonly createdAt: string;
  readonly sequence?: number;
};

export function applyAssistantDelta(
  messages: readonly ChatMessage[],
  input: {
    readonly id: string;
    readonly delta: string;
    readonly snapshot: string;
    readonly createdAt: string;
  },
): readonly ChatMessage[] {
  const index = messages.findIndex((message) => message.id === input.id);
  if (index < 0) {
    return [
      ...messages,
      {
        id: input.id,
        role: "assistant",
        text: input.snapshot,
        complete: false,
        createdAt: input.createdAt,
      },
    ];
  }
  const existing = messages[index];
  if (!existing || existing.complete) return messages;
  const appended = `${existing.text}${input.delta}`;
  const text = appended === input.snapshot ? appended : input.snapshot;
  return replaceMessage(messages, index, { ...existing, text });
}

export function completeAssistantMessage(
  messages: readonly ChatMessage[],
  id: string,
  text: string,
  createdAt: string,
): readonly ChatMessage[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) {
    return [
      ...messages,
      { id, role: "assistant", text, complete: true, createdAt },
    ];
  }
  const existing = messages[index];
  if (!existing) return messages;
  return replaceMessage(messages, index, { ...existing, text, complete: true });
}

export function discardIncompleteAssistantMessage(
  messages: readonly ChatMessage[],
  id: string,
): readonly ChatMessage[] {
  return messages.filter(
    (message) => message.id !== id || message.complete,
  );
}

function replaceMessage(
  messages: readonly ChatMessage[],
  index: number,
  replacement: ChatMessage,
): readonly ChatMessage[] {
  return messages.map((message, itemIndex) =>
    itemIndex === index ? replacement : message,
  );
}
