CREATE TABLE "agent_config_version_skills" (
	"tenant_id" uuid NOT NULL,
	"config_version_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	CONSTRAINT "agent_config_version_skills_config_version_id_skill_version_id_pk" PRIMARY KEY("config_version_id","skill_version_id")
);
--> statement-breakpoint
CREATE TABLE "agent_config_version_tools" (
	"tenant_id" uuid NOT NULL,
	"config_version_id" uuid NOT NULL,
	"tool_id" varchar(80) NOT NULL,
	CONSTRAINT "agent_config_version_tools_config_version_id_tool_id_pk" PRIMARY KEY("config_version_id","tool_id"),
	CONSTRAINT "agent_config_version_tools_id_format" CHECK ("agent_config_version_tools"."tool_id" ~ '^[a-z][a-z0-9_]{0,79}$')
);
--> statement-breakpoint
CREATE TABLE "agent_config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_config_versions_version_positive" CHECK ("agent_config_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "agent_configurations" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"current_version_id" uuid NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stable_key" varchar(80) NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_stable_key_format" CHECK ("agents"."stable_key" ~ '^[a-z][a-z0-9_-]{0,79}$')
);
--> statement-breakpoint
CREATE TABLE "skill_configurations" (
	"skill_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"current_version_id" uuid NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(500) NOT NULL,
	"markdown" text NOT NULL,
	"created_source" varchar(16) NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_versions_version_positive" CHECK ("skill_versions"."version" > 0),
	CONSTRAINT "skill_versions_name_format" CHECK ("skill_versions"."name" ~ '^[a-z][a-z0-9_]{0,79}$'),
	CONSTRAINT "skill_versions_created_source_allowed" CHECK ("skill_versions"."created_source" IN ('SYSTEM', 'ADMIN', 'AGENT')),
	CONSTRAINT "skill_versions_description_not_blank" CHECK (btrim("skill_versions"."description") <> ''),
	CONSTRAINT "skill_versions_markdown_not_blank" CHECK (btrim("skill_versions"."markdown") <> '')
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"created_source" varchar(16) NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_name_format" CHECK ("skills"."name" ~ '^[a-z][a-z0-9_]{0,79}$'),
	CONSTRAINT "skills_created_source_allowed" CHECK ("skills"."created_source" IN ('SYSTEM', 'ADMIN', 'AGENT'))
);
--> statement-breakpoint
CREATE TABLE "conversation_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_source" varchar(16) NOT NULL,
	"request_id" uuid NOT NULL,
	"storage_key" uuid NOT NULL,
	"display_name" varchar(240) NOT NULL,
	"extension" varchar(8) NOT NULL,
	"declared_media_type" varchar(32) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bound_at" timestamp with time zone,
	CONSTRAINT "conversation_attachments_owner_source_allowed" CHECK ("conversation_attachments"."owner_source" IN ('LOCAL', 'EMBEDDED')),
	CONSTRAINT "conversation_attachments_status_allowed" CHECK ("conversation_attachments"."status" IN ('PENDING', 'BOUND')),
	CONSTRAINT "conversation_attachments_extension_allowed" CHECK ("conversation_attachments"."extension" IN ('.png', '.jpg', '.jpeg', '.webp', '.pdf')),
	CONSTRAINT "conversation_attachments_media_type_allowed" CHECK ("conversation_attachments"."declared_media_type" IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
	CONSTRAINT "conversation_attachments_size_positive" CHECK ("conversation_attachments"."size_bytes" > 0),
	CONSTRAINT "conversation_attachments_binding_consistent" CHECK (("conversation_attachments"."status" = 'PENDING' AND "conversation_attachments"."conversation_id" IS NULL AND "conversation_attachments"."message_id" IS NULL AND "conversation_attachments"."bound_at" IS NULL) OR ("conversation_attachments"."status" = 'BOUND' AND "conversation_attachments"."conversation_id" IS NOT NULL AND "conversation_attachments"."message_id" IS NOT NULL AND "conversation_attachments"."bound_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_config_versions_tenant_id_unique" ON "agent_config_versions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_config_versions_agent_version_unique" ON "agent_config_versions" USING btree ("tenant_id","agent_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_configurations_tenant_agent_unique" ON "agent_configurations" USING btree ("tenant_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_configurations_current_version_unique" ON "agent_configurations" USING btree ("current_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_tenant_id_unique" ON "agents" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_tenant_key_unique" ON "agents" USING btree ("tenant_id","stable_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_tenant_main_unique" ON "agents" USING btree ("tenant_id") WHERE "agents"."is_main" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_configurations_tenant_skill_unique" ON "skill_configurations" USING btree ("tenant_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_configurations_current_version_unique" ON "skill_configurations" USING btree ("current_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_tenant_id_unique" ON "skill_versions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_skill_version_unique" ON "skill_versions" USING btree ("tenant_id","skill_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_tenant_id_unique" ON "skills" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_tenant_name_unique" ON "skills" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_attachments_owner_request_unique" ON "conversation_attachments" USING btree ("tenant_id","owner_user_id","owner_source","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_attachments_storage_key_unique" ON "conversation_attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_tenant_conversation_id_unique" ON "conversation_messages" USING btree ("tenant_id","conversation_id","id");--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "agent_config_version_id" uuid;--> statement-breakpoint
ALTER TABLE "model_config_versions" ADD COLUMN "supports_image_input" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_config_versions" ADD COLUMN "supports_native_pdf_input" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_config_version_skills" ADD CONSTRAINT "agent_config_version_skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_version_skills" ADD CONSTRAINT "agent_config_version_skills_tenant_config_fk" FOREIGN KEY ("tenant_id","config_version_id") REFERENCES "public"."agent_config_versions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_version_skills" ADD CONSTRAINT "agent_config_version_skills_tenant_skill_version_fk" FOREIGN KEY ("tenant_id","skill_version_id") REFERENCES "public"."skill_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_version_tools" ADD CONSTRAINT "agent_config_version_tools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_version_tools" ADD CONSTRAINT "agent_config_version_tools_tenant_config_fk" FOREIGN KEY ("tenant_id","config_version_id") REFERENCES "public"."agent_config_versions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_versions" ADD CONSTRAINT "agent_config_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_versions" ADD CONSTRAINT "agent_config_versions_created_by_user_id_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_versions" ADD CONSTRAINT "agent_config_versions_tenant_agent_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configurations" ADD CONSTRAINT "agent_configurations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configurations" ADD CONSTRAINT "agent_configurations_updated_by_user_id_auth_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configurations" ADD CONSTRAINT "agent_configurations_tenant_agent_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configurations" ADD CONSTRAINT "agent_configurations_tenant_version_fk" FOREIGN KEY ("tenant_id","current_version_id") REFERENCES "public"."agent_config_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_configurations" ADD CONSTRAINT "skill_configurations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_configurations" ADD CONSTRAINT "skill_configurations_updated_by_user_id_auth_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_configurations" ADD CONSTRAINT "skill_configurations_tenant_skill_fk" FOREIGN KEY ("tenant_id","skill_id") REFERENCES "public"."skills"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_configurations" ADD CONSTRAINT "skill_configurations_tenant_version_fk" FOREIGN KEY ("tenant_id","current_version_id") REFERENCES "public"."skill_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_created_by_user_id_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_tenant_skill_fk" FOREIGN KEY ("tenant_id","skill_id") REFERENCES "public"."skills"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_created_by_user_id_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_owner_user_id_auth_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_owner_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id","owner_user_id","owner_source") REFERENCES "public"."conversations"("tenant_id","id","owner_user_id","owner_source") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_message_fk" FOREIGN KEY ("tenant_id","conversation_id","message_id") REFERENCES "public"."conversation_messages"("tenant_id","conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_versions_skill_created_index" ON "skill_versions" USING btree ("tenant_id","skill_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_attachments_owner_quota_index" ON "conversation_attachments" USING btree ("tenant_id","owner_user_id","owner_source");--> statement-breakpoint
CREATE INDEX "conversation_attachments_pending_cleanup_index" ON "conversation_attachments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "conversation_attachments_conversation_index" ON "conversation_attachments" USING btree ("tenant_id","conversation_id","created_at","id");--> statement-breakpoint
INSERT INTO "skills" ("id", "tenant_id", "name", "created_source")
SELECT gen_random_uuid(), "id", 'evidence_research', 'SYSTEM'
FROM "tenants";--> statement-breakpoint
INSERT INTO "skill_versions" ("id", "tenant_id", "skill_id", "version", "name", "description", "markdown", "created_source")
SELECT gen_random_uuid(), "tenant_id", "id", 1, 'evidence_research', '在回答需要事实依据、来源核对或材料比较的问题时加载。', E'# 证据研究\n\n回答前先判断当前问题是否需要证据，以及需要哪些类型的证据。\n\n- 优先读取当前会话附件、已启用的网页 Tool 或外部知识 Tool。\n- 明确区分 Tool 返回结果、用户提供材料和模型自身知识。\n- 对无法验证、证据冲突或材料不足的部分明确说明不确定性。\n- 保留对实际读取来源的可理解引用，不得虚构或暗示读取过未读取的来源。\n- 本 Skill 只提供工作方法，不扩大身份、Tool、附件或知识源访问权限。\n', 'SYSTEM'
FROM "skills"
WHERE "name" = 'evidence_research' AND "created_source" = 'SYSTEM';--> statement-breakpoint
INSERT INTO "skill_configurations" ("skill_id", "tenant_id", "current_version_id")
SELECT "skill_id", "tenant_id", "id"
FROM "skill_versions"
WHERE "name" = 'evidence_research' AND "version" = 1 AND "created_source" = 'SYSTEM';--> statement-breakpoint
INSERT INTO "agents" ("id", "tenant_id", "stable_key", "is_main")
SELECT gen_random_uuid(), "id", 'main', true
FROM "tenants";--> statement-breakpoint
INSERT INTO "agent_config_versions" ("id", "tenant_id", "agent_id", "version")
SELECT gen_random_uuid(), "tenant_id", "id", "version"
FROM "agents"
CROSS JOIN (VALUES (1), (2)) AS versions("version")
WHERE "stable_key" = 'main' AND "is_main" = true;--> statement-breakpoint
INSERT INTO "agent_config_version_tools" ("tenant_id", "config_version_id", "tool_id")
SELECT "tenant_id", "id", "tool_id"
FROM "agent_config_versions"
CROSS JOIN (VALUES ('todo'), ('list_conversation_attachments'), ('read_conversation_attachment')) AS tools("tool_id")
WHERE "version" = 2;--> statement-breakpoint
INSERT INTO "agent_config_version_skills" ("tenant_id", "config_version_id", "skill_version_id")
SELECT agent_version."tenant_id", agent_version."id", skill_configuration."current_version_id"
FROM "agent_config_versions" AS agent_version
INNER JOIN "skill_configurations" AS skill_configuration
	ON skill_configuration."tenant_id" = agent_version."tenant_id"
WHERE agent_version."version" = 2;--> statement-breakpoint
INSERT INTO "agent_configurations" ("agent_id", "tenant_id", "current_version_id")
SELECT "agent_id", "tenant_id", "id"
FROM "agent_config_versions"
WHERE "version" = 2;--> statement-breakpoint
UPDATE "conversation_turns" AS turn
SET "agent_config_version_id" = baseline."id"
FROM "agent_config_versions" AS baseline
WHERE baseline."tenant_id" = turn."tenant_id" AND baseline."version" = 1;--> statement-breakpoint
ALTER TABLE "conversation_turns" ALTER COLUMN "agent_config_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_tenant_agent_config_version_fk" FOREIGN KEY ("tenant_id","agent_config_version_id") REFERENCES "public"."agent_config_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_turns_agent_config_index" ON "conversation_turns" USING btree ("agent_config_version_id","status");--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_bound_attachment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.status = 'BOUND' AND (
		NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
		NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR
		NEW.owner_source IS DISTINCT FROM OLD.owner_source OR
		NEW.storage_key IS DISTINCT FROM OLD.storage_key OR
		NEW.status IS DISTINCT FROM OLD.status OR
		NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR
		NEW.message_id IS DISTINCT FROM OLD.message_id OR
		NEW.bound_at IS DISTINCT FROM OLD.bound_at
	) THEN
		RAISE EXCEPTION 'BOUND conversation attachments are immutable';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "conversation_attachments_bound_immutable"
BEFORE UPDATE ON "conversation_attachments"
FOR EACH ROW
EXECUTE FUNCTION prevent_bound_attachment_mutation();
