import type { HandleMessageStreamEvent } from "eve/client";
import { conversationEventReceipts } from "@/src/server/db/schema";
import type { ConversationTransaction } from "./repository-types";

export async function recordConversationEventReceipt(
  transaction: ConversationTransaction,
  input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly eveCursor: bigint;
    readonly eventType: HandleMessageStreamEvent["type"];
    readonly eventAt: Date;
  },
): Promise<boolean> {
  const [inserted] = await transaction
    .insert(conversationEventReceipts)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: conversationEventReceipts.id });
  return Boolean(inserted);
}
