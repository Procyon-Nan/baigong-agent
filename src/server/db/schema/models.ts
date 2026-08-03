import { sql } from "drizzle-orm";
import {
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
import { authUsers } from "./authentication";
import { tenants } from "./tenants";

export const modelConfigVersions = pgTable(
  "model_config_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    version: integer("version").notNull(),
    providerDisplayName: varchar("provider_display_name", {
      length: 120,
    }).notNull(),
    baseUrl: text("base_url").notNull(),
    modelName: varchar("model_name", { length: 255 }).notNull(),
    contextWindowTokens: integer("context_window_tokens"),
    encryptedApiKey: text("encrypted_api_key"),
    credentialPurgedAt: timestamp("credential_purged_at", {
      withTimezone: true,
    }),
    createdByUserId: text("created_by_user_id").references(
      () => authUsers.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("model_config_versions_tenant_version_unique").on(
      table.tenantId,
      table.version,
    ),
    uniqueIndex("model_config_versions_tenant_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("model_config_versions_tenant_created_index").on(
      table.tenantId,
      table.createdAt,
    ),
    check("model_config_versions_version_positive", sql`${table.version} > 0`),
    check(
      "model_config_versions_context_window_positive",
      sql`${table.contextWindowTokens} IS NULL OR ${table.contextWindowTokens} > 0`,
    ),
  ],
);

export const modelConfigurations = pgTable(
  "model_configurations",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    currentVersionId: uuid("current_version_id").notNull(),
    updatedByUserId: text("updated_by_user_id").references(
      () => authUsers.id,
      { onDelete: "set null" },
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("model_configurations_current_version_unique").on(
      table.currentVersionId,
    ),
    foreignKey({
      name: "model_configurations_tenant_version_fk",
      columns: [table.tenantId, table.currentVersionId],
      foreignColumns: [modelConfigVersions.tenantId, modelConfigVersions.id],
    }),
  ],
);

export type ModelConfigVersion = typeof modelConfigVersions.$inferSelect;
export type ModelConfiguration = typeof modelConfigurations.$inferSelect;
