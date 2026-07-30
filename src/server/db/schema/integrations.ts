import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authSessions, authUsers } from "./authentication";
import { tenants } from "./tenants";

export const embeddedClients = pgTable(
  "embedded_clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: varchar("name", { length: 120 }).notNull(),
    clientId: varchar("client_id", { length: 64 }).notNull(),
    secretHash: text("secret_hash").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("embedded_clients_client_id_unique").on(table.clientId),
    index("embedded_clients_tenant_status_index").on(
      table.tenantId,
      table.status,
    ),
    check(
      "embedded_clients_status_allowed",
      sql`${table.status} IN ('ACTIVE', 'DISABLED', 'DELETED')`,
    ),
  ],
);

export const externalIdentities = pgTable(
  "external_identities",
  {
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => embeddedClients.id),
    externalUserId: varchar("external_user_id", { length: 255 }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.integrationId, table.externalUserId] }),
    uniqueIndex("external_identities_user_unique").on(table.userId),
  ],
);

export const embeddedTickets = pgTable(
  "embedded_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketDigest: varchar("ticket_digest", { length: 64 }).notNull(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => embeddedClients.id),
    externalUserId: varchar("external_user_id", { length: 255 }).notNull(),
    origin: text("origin").notNull(),
    agentId: varchar("agent_id", { length: 120 }).notNull(),
    jti: uuid("jti").notNull(),
    displayName: varchar("display_name", { length: 120 }),
    displayEmail: varchar("display_email", { length: 254 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("embedded_tickets_digest_unique").on(table.ticketDigest),
    uniqueIndex("embedded_tickets_jti_unique").on(table.jti),
    index("embedded_tickets_integration_expiry_index").on(
      table.integrationId,
      table.expiresAt,
    ),
  ],
);

export const embeddedSessions = pgTable(
  "embedded_sessions",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => authSessions.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => embeddedClients.id),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    agentId: varchar("agent_id", { length: 120 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("embedded_sessions_integration_expiry_index").on(
      table.integrationId,
      table.expiresAt,
    ),
    index("embedded_sessions_user_expiry_index").on(
      table.userId,
      table.expiresAt,
    ),
  ],
);

export type EmbeddedClient = typeof embeddedClients.$inferSelect;
