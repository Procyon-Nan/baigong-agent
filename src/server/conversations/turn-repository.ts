import { and, eq } from "drizzle-orm";
import { conversationTurns } from "@/src/server/db/schema";
import type { ConversationTransaction } from "./repository-types";

export async function findConversationTurnByEveId(
  transaction: ConversationTransaction,
  conversationId: string,
  eveTurnId: string,
) {
  const [turn] = await transaction
    .select({
      id: conversationTurns.id,
      inputMessageId: conversationTurns.inputMessageId,
      status: conversationTurns.status,
    })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.conversationId, conversationId),
        eq(conversationTurns.eveTurnId, eveTurnId),
      ),
    )
    .limit(1);
  return turn;
}
