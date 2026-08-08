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

export function deriveAttachmentConversationTitle(
  attachments: readonly { readonly displayName: string }[],
): string {
  const [first] = attachments;
  if (!first) return DEFAULT_CONVERSATION_TITLE;
  const suffix = attachments.length > 1 ? ` 等 ${attachments.length} 个附件` : "";
  return Array.from(`${first.displayName}${suffix}`)
    .slice(0, MAX_CONVERSATION_TITLE_CHARACTERS)
    .join("");
}
