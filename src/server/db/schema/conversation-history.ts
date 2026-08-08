import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  conversations,
  conversationTurns,
  type ConversationStatus,
  type ConversationTurnStatus,
} from "./conversations";
import { tenants } from "./tenants";

export type ConversationMessageRole = "USER" | "ASSISTANT" | "DELEGATION";

export type ConversationMessageStatus =
  | "STREAMING"
  | "COMPLETED"
  | "STOPPED"
  | "HIDDEN";

export type ConversationActionType =
  | "TOOL"
  | "SKILL"
  | "SUBAGENT"
  | "REMOTE_AGENT"
  | "TERMINAL";

export type ConversationActionStatus =
  | "PENDING"
  | "COMPLETED"
  | "FAILED"
  | "REJECTED";

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id").notNull(),
    turnId: uuid("turn_id").notNull(),
    sequence: integer("sequence").notNull(),
    role: varchar("role", { length: 16 })
      .$type<ConversationMessageRole>()
      .notNull(),
    status: varchar("status", { length: 16 })
      .$type<ConversationMessageStatus>()
      .notNull(),
    blockId: varchar("block_id", { length: 160 }).notNull(),
    body: text("body").notNull(),
    stepIndex: integer("step_index"),
    firstEveCursor: bigint("first_eve_cursor", { mode: "bigint" }),
    lastEveCursor: bigint("last_eve_cursor", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversation_messages_sequence_unique").on(
      table.conversationId,
      table.sequence,
    ),
    uniqueIndex("conversation_messages_block_unique").on(
      table.conversationId,
      table.blockId,
    ),
    uniqueIndex("conversation_messages_tenant_conversation_id_unique").on(
      table.tenantId,
      table.conversationId,
      table.id,
    ),
    index("conversation_messages_history_index").on(
      table.tenantId,
      table.conversationId,
      table.sequence,
    ),
    index("conversation_messages_turn_index").on(
      table.conversationId,
      table.turnId,
      table.sequence,
    ),
    index("conversation_messages_user_nodes_index").on(
      table.conversationId,
      table.role,
      table.sequence,
    ),
    foreignKey({
      name: "conversation_messages_tenant_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "conversation_messages_tenant_turn_fk",
      columns: [table.tenantId, table.conversationId, table.turnId],
      foreignColumns: [
        conversationTurns.tenantId,
        conversationTurns.conversationId,
        conversationTurns.id,
      ],
    }).onDelete("cascade"),
    check(
      "conversation_messages_role_allowed",
      sql`${table.role} IN ('USER', 'ASSISTANT', 'DELEGATION')`,
    ),
    check(
      "conversation_messages_status_allowed",
      sql`${table.status} IN ('STREAMING', 'COMPLETED', 'STOPPED', 'HIDDEN')`,
    ),
    check(
      "conversation_messages_sequence_positive",
      sql`${table.sequence} > 0`,
    ),
    check(
      "conversation_messages_step_index_nonnegative",
      sql`${table.stepIndex} IS NULL OR ${table.stepIndex} >= 0`,
    ),
    check(
      "conversation_messages_cursors_nonnegative",
      sql`(${table.firstEveCursor} IS NULL OR ${table.firstEveCursor} >= 0) AND (${table.lastEveCursor} IS NULL OR ${table.lastEveCursor} >= 0)`,
    ),
    check(
      "conversation_messages_cursor_order",
      sql`${table.firstEveCursor} IS NULL OR ${table.lastEveCursor} IS NULL OR ${table.lastEveCursor} >= ${table.firstEveCursor}`,
    ),
    check(
      "conversation_messages_role_state_consistent",
      sql`(${table.role} = 'ASSISTANT') OR (${table.status} = 'COMPLETED')`,
    ),
  ],
);

export const conversationEventReceipts = pgTable(
  "conversation_event_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id").notNull(),
    eveCursor: bigint("eve_cursor", { mode: "bigint" }).notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversation_event_receipts_cursor_unique").on(
      table.conversationId,
      table.eveCursor,
    ),
    index("conversation_event_receipts_tenant_time_index").on(
      table.tenantId,
      table.eventAt,
    ),
    foreignKey({
      name: "conversation_event_receipts_tenant_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    check(
      "conversation_event_receipts_cursor_nonnegative",
      sql`${table.eveCursor} >= 0`,
    ),
  ],
);

export const conversationStateEvents = pgTable(
  "conversation_state_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id").notNull(),
    turnId: uuid("turn_id"),
    eveCursor: bigint("eve_cursor", { mode: "bigint" }).notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    conversationStatus: varchar("conversation_status", { length: 24 }).$type<
      ConversationStatus
    >(),
    turnStatus: varchar("turn_status", { length: 16 }).$type<
      ConversationTurnStatus
    >(),
    publicErrorCode: varchar("public_error_code", { length: 64 }),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversation_state_events_cursor_unique").on(
      table.conversationId,
      table.eveCursor,
    ),
    index("conversation_state_events_history_index").on(
      table.tenantId,
      table.conversationId,
      table.eveCursor,
    ),
    foreignKey({
      name: "conversation_state_events_tenant_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "conversation_state_events_tenant_turn_fk",
      columns: [table.tenantId, table.conversationId, table.turnId],
      foreignColumns: [
        conversationTurns.tenantId,
        conversationTurns.conversationId,
        conversationTurns.id,
      ],
    }).onDelete("cascade"),
    check(
      "conversation_state_events_cursor_nonnegative",
      sql`${table.eveCursor} >= 0`,
    ),
    check(
      "conversation_state_events_conversation_status_allowed",
      sql`${table.conversationStatus} IS NULL OR ${table.conversationStatus} IN ('STARTING', 'RUNNING', 'CANCELLING', 'WAITING', 'TERMINAL_FAILED', 'TERMINAL_COMPLETED')`,
    ),
    check(
      "conversation_state_events_turn_status_allowed",
      sql`${table.turnStatus} IS NULL OR ${table.turnStatus} IN ('SUBMITTING', 'RUNNING', 'CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    ),
  ],
);

export const conversationStepUsages = pgTable(
  "conversation_step_usages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id").notNull(),
    turnId: uuid("turn_id").notNull(),
    eveTurnId: text("eve_turn_id").notNull(),
    stepIndex: integer("step_index").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    costUsd: numeric("cost_usd", {
      precision: 20,
      scale: 8,
      mode: "number",
    }),
    eveCursor: bigint("eve_cursor", { mode: "bigint" }).notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversation_step_usages_cursor_unique").on(
      table.conversationId,
      table.eveCursor,
    ),
    index("conversation_step_usages_conversation_index").on(
      table.tenantId,
      table.conversationId,
      table.eventAt,
    ),
    foreignKey({
      name: "conversation_step_usages_tenant_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "conversation_step_usages_tenant_turn_fk",
      columns: [table.tenantId, table.conversationId, table.turnId],
      foreignColumns: [
        conversationTurns.tenantId,
        conversationTurns.conversationId,
        conversationTurns.id,
      ],
    }).onDelete("cascade"),
    check(
      "conversation_step_usages_step_index_nonnegative",
      sql`${table.stepIndex} >= 0`,
    ),
    check(
      "conversation_step_usages_tokens_nonnegative",
      sql`(${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0) AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0) AND (${table.cacheReadTokens} IS NULL OR ${table.cacheReadTokens} >= 0) AND (${table.cacheWriteTokens} IS NULL OR ${table.cacheWriteTokens} >= 0)`,
    ),
    check(
      "conversation_step_usages_cost_nonnegative",
      sql`${table.costUsd} IS NULL OR ${table.costUsd} >= 0`,
    ),
    check(
      "conversation_step_usages_cursor_nonnegative",
      sql`${table.eveCursor} >= 0`,
    ),
  ],
);

export const conversationActionAudits = pgTable(
  "conversation_action_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id").notNull(),
    turnId: uuid("turn_id").notNull(),
    eveTurnId: text("eve_turn_id").notNull(),
    stepIndex: integer("step_index").notNull(),
    callId: text("call_id").notNull(),
    actionType: varchar("action_type", { length: 24 })
      .$type<ConversationActionType>()
      .notNull(),
    actionName: varchar("action_name", { length: 240 }).notNull(),
    status: varchar("status", { length: 16 })
      .$type<ConversationActionStatus>()
      .default("PENDING")
      .notNull(),
    requestEveCursor: bigint("request_eve_cursor", {
      mode: "bigint",
    }).notNull(),
    resultEveCursor: bigint("result_eve_cursor", { mode: "bigint" }),
    errorCode: varchar("error_code", { length: 64 }),
    detailsAvailable: boolean("details_available").default(true).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversation_action_audits_request_call_unique").on(
      table.conversationId,
      table.requestEveCursor,
      table.callId,
    ),
    index("conversation_action_audits_turn_index").on(
      table.tenantId,
      table.conversationId,
      table.turnId,
      table.stepIndex,
    ),
    index("conversation_action_audits_status_index").on(
      table.tenantId,
      table.status,
      table.startedAt,
    ),
    foreignKey({
      name: "conversation_action_audits_tenant_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "conversation_action_audits_tenant_turn_fk",
      columns: [table.tenantId, table.conversationId, table.turnId],
      foreignColumns: [
        conversationTurns.tenantId,
        conversationTurns.conversationId,
        conversationTurns.id,
      ],
    }).onDelete("cascade"),
    check(
      "conversation_action_audits_type_allowed",
      sql`${table.actionType} IN ('TOOL', 'SKILL', 'SUBAGENT', 'REMOTE_AGENT', 'TERMINAL')`,
    ),
    check(
      "conversation_action_audits_status_allowed",
      sql`${table.status} IN ('PENDING', 'COMPLETED', 'FAILED', 'REJECTED')`,
    ),
    check(
      "conversation_action_audits_step_index_nonnegative",
      sql`${table.stepIndex} >= 0`,
    ),
    check(
      "conversation_action_audits_cursors_nonnegative",
      sql`${table.requestEveCursor} >= 0 AND (${table.resultEveCursor} IS NULL OR ${table.resultEveCursor} >= ${table.requestEveCursor})`,
    ),
    check(
      "conversation_action_audits_completion_consistent",
      sql`(${table.status} = 'PENDING' AND ${table.resultEveCursor} IS NULL AND ${table.completedAt} IS NULL) OR (${table.status} <> 'PENDING' AND ${table.resultEveCursor} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
  ],
);

export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type ConversationEventReceipt =
  typeof conversationEventReceipts.$inferSelect;
export type ConversationStateEvent = typeof conversationStateEvents.$inferSelect;
export type ConversationStepUsage = typeof conversationStepUsages.$inferSelect;
export type ConversationActionAudit =
  typeof conversationActionAudits.$inferSelect;
