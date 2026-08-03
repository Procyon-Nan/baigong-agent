import type { Database } from "@/src/server/db/client";

export type ConversationTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
