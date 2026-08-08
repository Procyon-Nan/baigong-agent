import "server-only";

import type { UserContent } from "ai";
import type { ReservedConversationAttachment } from "@/src/server/conversations/types";
import { readAttachmentFile } from "@/src/server/attachments/storage";

export async function buildEveUserContent(
  message: string,
  attachments: readonly ReservedConversationAttachment[],
): Promise<string | UserContent> {
  if (attachments.length === 0) return message;
  const content: UserContent = [];
  if (message.trim().length > 0) content.push({ type: "text", text: message });
  for (const attachment of attachments) {
    const bytes = await readAttachmentFile(attachment.storageKey);
    content.push({
      type: "file",
      data: `data:${attachment.mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
      mediaType: attachment.mediaType,
      filename: attachment.displayName,
    });
  }
  return content;
}
