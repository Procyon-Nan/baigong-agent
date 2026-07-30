import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  index,
} from "drizzle-orm/pg-core";
import { authUsers } from "./authentication";
import { tenants } from "./tenants";

export const securityAuditEvents = pgTable(
  "security_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actorUserId: text("actor_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    actorSource: varchar("actor_source", { length: 24 }).notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    targetType: varchar("target_type", { length: 40 }).notNull(),
    targetId: text("target_id"),
    outcome: varchar("outcome", { length: 16 }).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("security_audit_tenant_time_index").on(
      table.tenantId,
      table.createdAt,
    ),
    index("security_audit_action_time_index").on(table.action, table.createdAt),
  ],
);
