const DEFAULT_CONVERSATION_TITLE = "新对话";
const MAX_CONVERSATION_TITLE_CHARACTERS = 60;

export function deriveConversationTitle(message: string): string {
  const plainText = message
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_~>#|]/gu, " ")
    .replace(/^\s*[-+]\s+/gmu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!plainText) return DEFAULT_CONVERSATION_TITLE;
  return Array.from(plainText)
    .slice(0, MAX_CONVERSATION_TITLE_CHARACTERS)
    .join("");
}
