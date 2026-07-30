import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authUsers } from "./authentication";
import { tenants } from "./tenants";

export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    source: varchar("source", { length: 16 }).notNull(),
    role: varchar("role", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    displayEmail: varchar("display_email", { length: 254 }),
    mustChangePassword: boolean("must_change_password")
      .default(false)
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("user_profiles_tenant_source_index").on(table.tenantId, table.source),
    check(
      "user_profiles_source_allowed",
      sql`${table.source} IN ('LOCAL', 'EMBEDDED')`,
    ),
    check(
      "user_profiles_role_allowed",
      sql`${table.role} IN ('USER', 'ADMIN')`,
    ),
    check(
      "user_profiles_status_allowed",
      sql`${table.status} IN ('ACTIVE', 'DISABLED')`,
    ),
    check(
      "user_profiles_embedded_role",
      sql`${table.source} <> 'EMBEDDED' OR ${table.role} = 'USER'`,
    ),
    check(
      "user_profiles_embedded_password_flag",
      sql`${table.source} <> 'EMBEDDED' OR ${table.mustChangePassword} = false`,
    ),
  ],
);

export type UserProfile = typeof userProfiles.$inferSelect;
