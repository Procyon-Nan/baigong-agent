import { sql } from "drizzle-orm";
import {
  bigint,
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { IdentitySource } from "@/src/server/domain/identity";
import { authUsers } from "./authentication";
import { agentConfigVersions } from "./agent-capabilities";
import { modelConfigVersions } from "./models";
import { tenants } from "./tenants";

export type ConversationStatus =
  | "STARTING"
  | "RUNNING"
  | "CANCELLING"
  | "WAITING"
  | "TERMINAL_FAILED"
  | "TERMINAL_COMPLETED";

export type ConversationKind = "MAIN" | "SUBAGENT";

export type ConversationLinkStatus =
  | "NOT_APPLICABLE"
  | "PENDING"
  | "VERIFIED"
  | "FAILED";

export type ConversationTurnStatus =
  | "SUBMITTING"
  | "RUNNING"
  | "CANCELLING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => authUsers.id),
    ownerSource: varchar("owner_source", { length: 16 })
      .$type<IdentitySource>()
      .notNull(),
    kind: varchar("kind", { length: 16 })
      .$type<ConversationKind>()
      .default("MAIN")
      .notNull(),
    title: varchar("title", { length: 240 }).default("新对话").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    parentConversationId: uuid("parent_conversation_id"),
    parentTurnId: uuid("parent_turn_id").references(
      (): AnyPgColumn => conversationTurns.id,
    ),
    delegationCallId: text("delegation_call_id"),
    subagentName: varchar("subagent_name", { length: 120 }),
    linkStatus: varchar("link_status", { length: 24 })
      .$type<ConversationLinkStatus>()
      .default("NOT_APPLICABLE")
      .notNull(),
    parentCalledCursor: bigint("parent_called_cursor", { mode: "bigint" }),
    childStartedCursor: bigint("child_started_cursor", { mode: "bigint" }),
    agentId: varchar("agent_id", { length: 120 }).notNull(),
    eveSessionId: text("eve_session_id"),
    encryptedContinuationToken: text("encrypted_continuation_token"),
    continuationTokenRevision: integer("continuation_token_revision")
      .default(0)
      .notNull(),
    status: varchar("status", { length: 24 })
      .$type<ConversationStatus>()
      .notNull(),
    activeTurnId: uuid("active_turn_id"),
    lastEveCursor: bigint("last_eve_cursor", { mode: "bigint" }),
    nextMessageSequence: integer("next_message_sequence").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversations_eve_session_unique").on(table.eveSessionId),
    uniqueIndex("conversations_tenant_id_unique").on(table.tenantId, table.id),
    uniqueIndex("conversations_tenant_owner_identity_unique").on(
      table.tenantId,
      table.id,
      table.ownerUserId,
      table.ownerSource,
    ),
    uniqueIndex("conversations_parent_called_cursor_unique").on(
      table.parentConversationId,
      table.parentCalledCursor,
    ),
    index("conversations_owner_listing_index").on(
      table.tenantId,
      table.ownerUserId,
      table.ownerSource,
      table.kind,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
    index("conversations_parent_index").on(
      table.tenantId,
      table.parentConversationId,
      table.createdAt,
    ),
    index("conversations_owner_status_index").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
    ),
    foreignKey({
      name: "conversations_parent_owner_identity_fk",
      columns: [
        table.tenantId,
        table.parentConversationId,
        table.ownerUserId,
        table.ownerSource,
      ],
      foreignColumns: [
        table.tenantId,
        table.id,
        table.ownerUserId,
        table.ownerSource,
      ],
    }).onDelete("cascade"),
    check(
      "conversations_owner_source_allowed",
      sql`${table.ownerSource} IN ('LOCAL', 'EMBEDDED')`,
    ),
    check(
      "conversations_status_allowed",
      sql`${table.status} IN ('STARTING', 'RUNNING', 'CANCELLING', 'WAITING', 'TERMINAL_FAILED', 'TERMINAL_COMPLETED')`,
    ),
    check(
      "conversations_kind_allowed",
      sql`${table.kind} IN ('MAIN', 'SUBAGENT')`,
    ),
    check(
      "conversations_link_status_allowed",
      sql`${table.linkStatus} IN ('NOT_APPLICABLE', 'PENDING', 'VERIFIED', 'FAILED')`,
    ),
    check(
      "conversations_kind_fields_consistent",
      sql`(${table.kind} = 'MAIN' AND ${table.parentConversationId} IS NULL AND ${table.parentTurnId} IS NULL AND ${table.delegationCallId} IS NULL AND ${table.subagentName} IS NULL AND ${table.linkStatus} = 'NOT_APPLICABLE' AND ${table.parentCalledCursor} IS NULL AND ${table.childStartedCursor} IS NULL) OR (${table.kind} = 'SUBAGENT' AND ${table.parentConversationId} IS NOT NULL AND ${table.parentTurnId} IS NOT NULL AND ${table.delegationCallId} IS NOT NULL AND ${table.subagentName} IS NOT NULL AND ${table.linkStatus} IN ('PENDING', 'VERIFIED', 'FAILED') AND ${table.archivedAt} IS NULL)`,
    ),
    check(
      "conversations_continuation_revision_nonnegative",
      sql`${table.continuationTokenRevision} >= 0`,
    ),
    check(
      "conversations_next_message_sequence_nonnegative",
      sql`${table.nextMessageSequence} >= 0`,
    ),
    check(
      "conversations_link_cursors_nonnegative",
      sql`(${table.parentCalledCursor} IS NULL OR ${table.parentCalledCursor} >= 0) AND (${table.childStartedCursor} IS NULL OR ${table.childStartedCursor} >= 0)`,
    ),
    check(
      "conversations_active_turn_consistent",
      sql`(${table.status} IN ('STARTING', 'RUNNING', 'CANCELLING') AND ${table.activeTurnId} IS NOT NULL) OR (${table.status} NOT IN ('STARTING', 'RUNNING', 'CANCELLING') AND ${table.activeTurnId} IS NULL)`,
    ),
  ],
);

export const conversationTurns = pgTable(
  "conversation_turns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => authUsers.id),
    requestId: uuid("request_id").notNull(),
    eveTurnId: text("eve_turn_id"),
    modelConfigVersionId: uuid("model_config_version_id").notNull(),
    agentConfigVersionId: uuid("agent_config_version_id").notNull(),
    inputMessageId: uuid("input_message_id"),
    retryOfTurnId: uuid("retry_of_turn_id"),
    status: varchar("status", { length: 16 })
      .$type<ConversationTurnStatus>()
      .notNull(),
    publicErrorCode: varchar("public_error_code", { length: 64 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversation_turns_request_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.requestId,
    ),
    uniqueIndex("conversation_turns_eve_turn_unique").on(
      table.conversationId,
      table.eveTurnId,
    ),
    uniqueIndex("conversation_turns_tenant_conversation_id_unique").on(
      table.tenantId,
      table.conversationId,
      table.id,
    ),
    index("conversation_turns_conversation_time_index").on(
      table.conversationId,
      table.createdAt,
    ),
    index("conversation_turns_owner_status_index").on(
      table.tenantId,
      table.ownerUserId,
      table.status,
    ),
    index("conversation_turns_model_status_index").on(
      table.modelConfigVersionId,
      table.status,
    ),
    index("conversation_turns_agent_config_index").on(
      table.agentConfigVersionId,
      table.status,
    ),
    index("conversation_turns_input_message_index").on(table.inputMessageId),
    index("conversation_turns_retry_index").on(table.retryOfTurnId),
    foreignKey({
      name: "conversation_turns_tenant_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "conversation_turns_tenant_model_version_fk",
      columns: [table.tenantId, table.modelConfigVersionId],
      foreignColumns: [modelConfigVersions.tenantId, modelConfigVersions.id],
    }),
    foreignKey({
      name: "conversation_turns_tenant_agent_config_version_fk",
      columns: [table.tenantId, table.agentConfigVersionId],
      foreignColumns: [agentConfigVersions.tenantId, agentConfigVersions.id],
    }),
    foreignKey({
      name: "conversation_turns_retry_fk",
      columns: [table.tenantId, table.conversationId, table.retryOfTurnId],
      foreignColumns: [table.tenantId, table.conversationId, table.id],
    }),
    check(
      "conversation_turns_status_allowed",
      sql`${table.status} IN ('SUBMITTING', 'RUNNING', 'CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    ),
    check(
      "conversation_turns_retry_not_self",
      sql`${table.retryOfTurnId} IS NULL OR ${table.retryOfTurnId} <> ${table.id}`,
    ),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type ConversationTurn = typeof conversationTurns.$inferSelect;
