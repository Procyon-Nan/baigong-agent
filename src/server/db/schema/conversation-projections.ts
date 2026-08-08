import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { conversations } from "./conversations";
import { tenants } from "./tenants";

export const conversationDerivedProjectionStates = pgTable(
  "conversation_derived_projection_states",
  {
    conversationId: uuid("conversation_id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    lastEveCursor: bigint("last_eve_cursor", { mode: "bigint" }),
    failureCount: integer("failure_count").default(0).notNull(),
    lastFailureCode: varchar("last_failure_code", { length: 64 }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("conversation_derived_projection_lag_index").on(
      table.tenantId,
      table.lastEveCursor,
    ),
    foreignKey({
      name: "conversation_derived_projection_tenant_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    check(
      "conversation_derived_projection_cursor_nonnegative",
      sql`${table.lastEveCursor} IS NULL OR ${table.lastEveCursor} >= 0`,
    ),
    check(
      "conversation_derived_projection_failure_count_nonnegative",
      sql`${table.failureCount} >= 0`,
    ),
  ],
);

export type ConversationDerivedProjectionState =
  typeof conversationDerivedProjectionStates.$inferSelect;
