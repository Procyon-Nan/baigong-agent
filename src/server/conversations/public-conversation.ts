import "server-only";

import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/src/server/db/client";
import { conversationTurns, conversations } from "@/src/server/db/schema";
import type { PublicConversation } from "./types";

export type PublicActiveTurn = {
  readonly id: string;
  readonly status: typeof conversationTurns.$inferSelect.status;
};

export async function readActiveTurns(
  database: Pick<Database, "select">,
  rows: readonly (typeof conversations.$inferSelect)[],
): Promise<Map<string, PublicActiveTurn>> {
  const ids = rows.flatMap((row) => (row.activeTurnId ? [row.activeTurnId] : []));
  if (ids.length === 0) return new Map();
  const turns = await database
    .select({ id: conversationTurns.id, status: conversationTurns.status })
    .from(conversationTurns)
    .where(inArray(conversationTurns.id, ids));
  return new Map(turns.map((turn) => [turn.id, turn]));
}

export async function readActiveTurn(
  database: Pick<Database, "select">,
  turnId: string,
): Promise<PublicActiveTurn | undefined> {
  const [turn] = await database
    .select({ id: conversationTurns.id, status: conversationTurns.status })
    .from(conversationTurns)
    .where(eq(conversationTurns.id, turnId))
    .limit(1);
  return turn;
}

export function toPublicConversation(
  conversation: typeof conversations.$inferSelect,
  activeTurn?: PublicActiveTurn | null,
): PublicConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    activeTurn: activeTurn
      ? { id: activeTurn.id, status: activeTurn.status }
      : null,
    archivedAt: conversation.archivedAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}
