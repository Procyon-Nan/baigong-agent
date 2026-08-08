import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authUsers } from "./authentication";
import { tenants } from "./tenants";

export type SkillCreatedSource = "SYSTEM" | "ADMIN" | "AGENT";

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    createdSource: varchar("created_source", { length: 16 })
      .$type<SkillCreatedSource>()
      .notNull(),
    createdByUserId: text("created_by_user_id").references(
      () => authUsers.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("skills_tenant_id_unique").on(table.tenantId, table.id),
    uniqueIndex("skills_tenant_name_unique").on(table.tenantId, table.name),
    check(
      "skills_name_format",
      sql`${table.name} ~ '^[a-z][a-z0-9_]{0,79}$'`,
    ),
    check(
      "skills_created_source_allowed",
      sql`${table.createdSource} IN ('SYSTEM', 'ADMIN', 'AGENT')`,
    ),
  ],
);

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id").notNull(),
    version: integer("version").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    markdown: text("markdown").notNull(),
    createdSource: varchar("created_source", { length: 16 })
      .$type<SkillCreatedSource>()
      .notNull(),
    createdByUserId: text("created_by_user_id").references(
      () => authUsers.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("skill_versions_tenant_id_unique").on(table.tenantId, table.id),
    uniqueIndex("skill_versions_skill_version_unique").on(
      table.tenantId,
      table.skillId,
      table.version,
    ),
    index("skill_versions_skill_created_index").on(
      table.tenantId,
      table.skillId,
      table.createdAt,
    ),
    foreignKey({
      name: "skill_versions_tenant_skill_fk",
      columns: [table.tenantId, table.skillId],
      foreignColumns: [skills.tenantId, skills.id],
    }).onDelete("cascade"),
    check("skill_versions_version_positive", sql`${table.version} > 0`),
    check(
      "skill_versions_name_format",
      sql`${table.name} ~ '^[a-z][a-z0-9_]{0,79}$'`,
    ),
    check(
      "skill_versions_created_source_allowed",
      sql`${table.createdSource} IN ('SYSTEM', 'ADMIN', 'AGENT')`,
    ),
    check("skill_versions_description_not_blank", sql`btrim(${table.description}) <> ''`),
    check("skill_versions_markdown_not_blank", sql`btrim(${table.markdown}) <> ''`),
  ],
);

export const skillConfigurations = pgTable(
  "skill_configurations",
  {
    skillId: uuid("skill_id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
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
    uniqueIndex("skill_configurations_tenant_skill_unique").on(
      table.tenantId,
      table.skillId,
    ),
    uniqueIndex("skill_configurations_current_version_unique").on(
      table.currentVersionId,
    ),
    foreignKey({
      name: "skill_configurations_tenant_skill_fk",
      columns: [table.tenantId, table.skillId],
      foreignColumns: [skills.tenantId, skills.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "skill_configurations_tenant_version_fk",
      columns: [table.tenantId, table.currentVersionId],
      foreignColumns: [skillVersions.tenantId, skillVersions.id],
    }),
  ],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    stableKey: varchar("stable_key", { length: 80 }).notNull(),
    isMain: boolean("is_main").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agents_tenant_id_unique").on(table.tenantId, table.id),
    uniqueIndex("agents_tenant_key_unique").on(table.tenantId, table.stableKey),
    uniqueIndex("agents_tenant_main_unique")
      .on(table.tenantId)
      .where(sql`${table.isMain} = true`),
    check(
      "agents_stable_key_format",
      sql`${table.stableKey} ~ '^[a-z][a-z0-9_-]{0,79}$'`,
    ),
  ],
);

export const agentConfigVersions = pgTable(
  "agent_config_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull(),
    version: integer("version").notNull(),
    createdByUserId: text("created_by_user_id").references(
      () => authUsers.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_config_versions_tenant_id_unique").on(
      table.tenantId,
      table.id,
    ),
    uniqueIndex("agent_config_versions_agent_version_unique").on(
      table.tenantId,
      table.agentId,
      table.version,
    ),
    foreignKey({
      name: "agent_config_versions_tenant_agent_fk",
      columns: [table.tenantId, table.agentId],
      foreignColumns: [agents.tenantId, agents.id],
    }).onDelete("cascade"),
    check("agent_config_versions_version_positive", sql`${table.version} > 0`),
  ],
);

export const agentConfigurations = pgTable(
  "agent_configurations",
  {
    agentId: uuid("agent_id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
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
    uniqueIndex("agent_configurations_tenant_agent_unique").on(
      table.tenantId,
      table.agentId,
    ),
    uniqueIndex("agent_configurations_current_version_unique").on(
      table.currentVersionId,
    ),
    foreignKey({
      name: "agent_configurations_tenant_agent_fk",
      columns: [table.tenantId, table.agentId],
      foreignColumns: [agents.tenantId, agents.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "agent_configurations_tenant_version_fk",
      columns: [table.tenantId, table.currentVersionId],
      foreignColumns: [agentConfigVersions.tenantId, agentConfigVersions.id],
    }),
  ],
);

export const agentConfigVersionTools = pgTable(
  "agent_config_version_tools",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    configVersionId: uuid("config_version_id").notNull(),
    toolId: varchar("tool_id", { length: 80 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.configVersionId, table.toolId] }),
    foreignKey({
      name: "agent_config_version_tools_tenant_config_fk",
      columns: [table.tenantId, table.configVersionId],
      foreignColumns: [agentConfigVersions.tenantId, agentConfigVersions.id],
    }).onDelete("cascade"),
    check(
      "agent_config_version_tools_id_format",
      sql`${table.toolId} ~ '^[a-z][a-z0-9_]{0,79}$'`,
    ),
  ],
);

export const agentConfigVersionSkills = pgTable(
  "agent_config_version_skills",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    configVersionId: uuid("config_version_id").notNull(),
    skillVersionId: uuid("skill_version_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.configVersionId, table.skillVersionId] }),
    foreignKey({
      name: "agent_config_version_skills_tenant_config_fk",
      columns: [table.tenantId, table.configVersionId],
      foreignColumns: [agentConfigVersions.tenantId, agentConfigVersions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "agent_config_version_skills_tenant_skill_version_fk",
      columns: [table.tenantId, table.skillVersionId],
      foreignColumns: [skillVersions.tenantId, skillVersions.id],
    }),
  ],
);

export type Agent = typeof agents.$inferSelect;
export type AgentConfigVersion = typeof agentConfigVersions.$inferSelect;
export type Skill = typeof skills.$inferSelect;
export type SkillVersion = typeof skillVersions.$inferSelect;
