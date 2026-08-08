import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { IdentitySource } from "@/src/server/domain/identity";
import { authUsers } from "./authentication";
import { conversationMessages } from "./conversation-history";
import { conversations } from "./conversations";
import { tenants } from "./tenants";

export type ConversationAttachmentStatus = "PENDING" | "BOUND";

export const conversationAttachments = pgTable(
  "conversation_attachments",
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
    requestId: uuid("request_id").notNull(),
    storageKey: uuid("storage_key").notNull(),
    displayName: varchar("display_name", { length: 240 }).notNull(),
    extension: varchar("extension", { length: 8 }).notNull(),
    declaredMediaType: varchar("declared_media_type", { length: 32 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: varchar("status", { length: 16 })
      .$type<ConversationAttachmentStatus>()
      .default("PENDING")
      .notNull(),
    conversationId: uuid("conversation_id"),
    messageId: uuid("message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("conversation_attachments_owner_request_unique").on(
      table.tenantId,
      table.ownerUserId,
      table.ownerSource,
      table.requestId,
    ),
    uniqueIndex("conversation_attachments_storage_key_unique").on(
      table.storageKey,
    ),
    index("conversation_attachments_owner_quota_index").on(
      table.tenantId,
      table.ownerUserId,
      table.ownerSource,
    ),
    index("conversation_attachments_pending_cleanup_index").on(
      table.status,
      table.createdAt,
    ),
    index("conversation_attachments_conversation_index").on(
      table.tenantId,
      table.conversationId,
      table.createdAt,
      table.id,
    ),
    foreignKey({
      name: "conversation_attachments_owner_conversation_fk",
      columns: [
        table.tenantId,
        table.conversationId,
        table.ownerUserId,
        table.ownerSource,
      ],
      foreignColumns: [
        conversations.tenantId,
        conversations.id,
        conversations.ownerUserId,
        conversations.ownerSource,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "conversation_attachments_message_fk",
      columns: [table.tenantId, table.conversationId, table.messageId],
      foreignColumns: [
        conversationMessages.tenantId,
        conversationMessages.conversationId,
        conversationMessages.id,
      ],
    }).onDelete("cascade"),
    check(
      "conversation_attachments_owner_source_allowed",
      sql`${table.ownerSource} IN ('LOCAL', 'EMBEDDED')`,
    ),
    check(
      "conversation_attachments_status_allowed",
      sql`${table.status} IN ('PENDING', 'BOUND')`,
    ),
    check(
      "conversation_attachments_extension_allowed",
      sql`${table.extension} IN ('.png', '.jpg', '.jpeg', '.webp', '.pdf')`,
    ),
    check(
      "conversation_attachments_media_type_allowed",
      sql`${table.declaredMediaType} IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')`,
    ),
    check(
      "conversation_attachments_size_positive",
      sql`${table.sizeBytes} > 0`,
    ),
    check(
      "conversation_attachments_binding_consistent",
      sql`(${table.status} = 'PENDING' AND ${table.conversationId} IS NULL AND ${table.messageId} IS NULL AND ${table.boundAt} IS NULL) OR (${table.status} = 'BOUND' AND ${table.conversationId} IS NOT NULL AND ${table.messageId} IS NOT NULL AND ${table.boundAt} IS NOT NULL)`,
    ),
  ],
);

export type ConversationAttachment =
  typeof conversationAttachments.$inferSelect;
