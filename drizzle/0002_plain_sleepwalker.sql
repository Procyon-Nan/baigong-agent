CREATE TABLE "conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"eve_turn_id" text,
	"model_config_version_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"public_error_code" varchar(64),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_turns_status_allowed" CHECK ("conversation_turns"."status" IN ('SUBMITTING', 'RUNNING', 'CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_source" varchar(16) NOT NULL,
	"agent_id" varchar(120) NOT NULL,
	"eve_session_id" text,
	"encrypted_continuation_token" text,
	"continuation_token_revision" integer DEFAULT 0 NOT NULL,
	"status" varchar(24) NOT NULL,
	"active_turn_id" uuid,
	"last_eve_cursor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_owner_source_allowed" CHECK ("conversations"."owner_source" IN ('LOCAL', 'EMBEDDED')),
	CONSTRAINT "conversations_status_allowed" CHECK ("conversations"."status" IN ('STARTING', 'RUNNING', 'CANCELLING', 'WAITING', 'TERMINAL_FAILED', 'TERMINAL_COMPLETED')),
	CONSTRAINT "conversations_continuation_revision_nonnegative" CHECK ("conversations"."continuation_token_revision" >= 0),
	CONSTRAINT "conversations_active_turn_consistent" CHECK (("conversations"."status" IN ('STARTING', 'RUNNING', 'CANCELLING') AND "conversations"."active_turn_id" IS NOT NULL) OR ("conversations"."status" NOT IN ('STARTING', 'RUNNING', 'CANCELLING') AND "conversations"."active_turn_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "model_config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"provider_display_name" varchar(120) NOT NULL,
	"base_url" text NOT NULL,
	"model_name" varchar(255) NOT NULL,
	"context_window_tokens" integer,
	"encrypted_api_key" text,
	"credential_purged_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_config_versions_version_positive" CHECK ("model_config_versions"."version" > 0),
	CONSTRAINT "model_config_versions_context_window_positive" CHECK ("model_config_versions"."context_window_tokens" IS NULL OR "model_config_versions"."context_window_tokens" > 0)
);
--> statement-breakpoint
CREATE TABLE "model_configurations" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"current_version_id" uuid NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_tenant_id_unique" ON "conversations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_config_versions_tenant_id_unique" ON "model_config_versions" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_owner_user_id_auth_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_tenant_model_version_fk" FOREIGN KEY ("tenant_id","model_config_version_id") REFERENCES "public"."model_config_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_user_id_auth_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_config_versions" ADD CONSTRAINT "model_config_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_config_versions" ADD CONSTRAINT "model_config_versions_created_by_user_id_auth_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_configurations" ADD CONSTRAINT "model_configurations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_configurations" ADD CONSTRAINT "model_configurations_updated_by_user_id_auth_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_configurations" ADD CONSTRAINT "model_configurations_tenant_version_fk" FOREIGN KEY ("tenant_id","current_version_id") REFERENCES "public"."model_config_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turns_request_unique" ON "conversation_turns" USING btree ("tenant_id","owner_user_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turns_eve_turn_unique" ON "conversation_turns" USING btree ("conversation_id","eve_turn_id");--> statement-breakpoint
CREATE INDEX "conversation_turns_conversation_time_index" ON "conversation_turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_turns_owner_status_index" ON "conversation_turns" USING btree ("tenant_id","owner_user_id","status");--> statement-breakpoint
CREATE INDEX "conversation_turns_model_status_index" ON "conversation_turns" USING btree ("model_config_version_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_eve_session_unique" ON "conversations" USING btree ("eve_session_id");--> statement-breakpoint
CREATE INDEX "conversations_owner_status_index" ON "conversations" USING btree ("tenant_id","owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "model_config_versions_tenant_version_unique" ON "model_config_versions" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE INDEX "model_config_versions_tenant_created_index" ON "model_config_versions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_configurations_current_version_unique" ON "model_configurations" USING btree ("current_version_id");
