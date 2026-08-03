import type { HandleMessageStreamEvent } from "eve/client";
import type { Database } from "@/src/server/db/client";
import { conversations } from "@/src/server/db/schema";

export type ConversationTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export type ConversationEventPersistenceContext = {
  readonly transaction: ConversationTransaction;
  readonly conversation: typeof conversations.$inferSelect;
  readonly cursor: bigint;
  readonly event: HandleMessageStreamEvent;
  readonly eventAt: Date;
};
