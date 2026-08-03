import { createHash } from "node:crypto";

export function userMessageBlockId(
  conversationId: string,
  turnId: string,
): string {
  return hashedBlockId("usr", conversationId, turnId);
}

export function delegationMessageBlockId(
  conversationId: string,
  turnId: string,
): string {
  return hashedBlockId("dlg", conversationId, turnId);
}

export function assistantMessageBlockId(
  conversationId: string,
  turnId: string,
  stepIndex: number,
): string {
  return hashedBlockId("asst", conversationId, turnId, String(stepIndex));
}

function hashedBlockId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join(":"))
    .digest("base64url")
    .slice(0, 22);
  return `${prefix}_${digest}`;
}
