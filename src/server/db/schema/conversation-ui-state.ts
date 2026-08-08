import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  PublicPendingInput,
  PublicTodoItem,
} from "@/src/shared/conversation-ui-state";
import { conversations } from "./conversations";
import { tenants } from "./tenants";

export const conversationUiStates = pgTable(
  "conversation_ui_states",
  {
    conversationId: uuid("conversation_id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    todos: jsonb("todos")
      .$type<readonly PublicTodoItem[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    todoEveCursor: bigint("todo_eve_cursor", { mode: "bigint" }),
    pendingInput: jsonb("pending_input").$type<PublicPendingInput>(),
    inputEveCursor: bigint("input_eve_cursor", { mode: "bigint" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversation_ui_states_tenant_conversation_unique").on(
      table.tenantId,
      table.conversationId,
    ),
    foreignKey({
      name: "conversation_ui_states_tenant_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    check(
      "conversation_ui_states_todo_cursor_nonnegative",
      sql`${table.todoEveCursor} IS NULL OR ${table.todoEveCursor} >= 0`,
    ),
    check(
      "conversation_ui_states_input_cursor_nonnegative",
      sql`${table.inputEveCursor} IS NULL OR ${table.inputEveCursor} >= 0`,
    ),
    check(
      "conversation_ui_states_todo_cursor_consistent",
      sql`(${table.todoEveCursor} IS NULL AND ${table.todos} = '[]'::jsonb) OR ${table.todoEveCursor} IS NOT NULL`,
    ),
    check(
      "conversation_ui_states_input_cursor_consistent",
      sql`(${table.pendingInput} IS NULL AND ${table.inputEveCursor} IS NULL) OR (${table.pendingInput} IS NOT NULL AND ${table.inputEveCursor} IS NOT NULL)`,
    ),
  ],
);

export type ConversationUiState = typeof conversationUiStates.$inferSelect;
