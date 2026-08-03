export type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly complete: boolean;
};

export function applyAssistantDelta(
  messages: readonly ChatMessage[],
  input: {
    readonly id: string;
    readonly delta: string;
    readonly snapshot: string;
  },
): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === input.id);
  if (index < 0) {
    return [
      ...messages,
      {
        id: input.id,
        role: "assistant",
        text: input.snapshot,
        complete: false,
      },
    ];
  }
  const existing = messages[index];
  if (!existing || existing.complete) return [...messages];
  const appended = `${existing.text}${input.delta}`;
  const text = appended === input.snapshot ? appended : input.snapshot;
  return replaceMessage(messages, index, { ...existing, text });
}

export function completeAssistantMessage(
  messages: readonly ChatMessage[],
  id: string,
  text: string,
): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) {
    return [...messages, { id, role: "assistant", text, complete: true }];
  }
  const existing = messages[index];
  if (!existing) return [...messages];
  return replaceMessage(messages, index, { ...existing, text, complete: true });
}

export function discardIncompleteAssistantMessage(
  messages: readonly ChatMessage[],
  id: string,
): ChatMessage[] {
  return messages.filter(
    (message) => message.id !== id || message.complete,
  );
}

function replaceMessage(
  messages: readonly ChatMessage[],
  index: number,
  replacement: ChatMessage,
): ChatMessage[] {
  return messages.map((message, itemIndex) =>
    itemIndex === index ? replacement : message,
  );
}
