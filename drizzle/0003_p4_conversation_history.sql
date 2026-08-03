CREATE TABLE "conversation_action_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"eve_turn_id" text NOT NULL,
	"step_index" integer NOT NULL,
	"call_id" text NOT NULL,
	"action_type" varchar(24) NOT NULL,
	"action_name" varchar(240) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"request_eve_cursor" bigint NOT NULL,
	"result_eve_cursor" bigint,
	"error_code" varchar(64),
	"details_available" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_action_audits_type_allowed" CHECK ("conversation_action_audits"."action_type" IN ('TOOL', 'SKILL', 'SUBAGENT', 'REMOTE_AGENT', 'TERMINAL')),
	CONSTRAINT "conversation_action_audits_status_allowed" CHECK ("conversation_action_audits"."status" IN ('PENDING', 'COMPLETED', 'FAILED', 'REJECTED')),
	CONSTRAINT "conversation_action_audits_step_index_nonnegative" CHECK ("conversation_action_audits"."step_index" >= 0),
	CONSTRAINT "conversation_action_audits_cursors_nonnegative" CHECK ("conversation_action_audits"."request_eve_cursor" >= 0 AND ("conversation_action_audits"."result_eve_cursor" IS NULL OR "conversation_action_audits"."result_eve_cursor" >= "conversation_action_audits"."request_eve_cursor")),
	CONSTRAINT "conversation_action_audits_completion_consistent" CHECK (("conversation_action_audits"."status" = 'PENDING' AND "conversation_action_audits"."result_eve_cursor" IS NULL AND "conversation_action_audits"."completed_at" IS NULL) OR ("conversation_action_audits"."status" <> 'PENDING' AND "conversation_action_audits"."result_eve_cursor" IS NOT NULL AND "conversation_action_audits"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "conversation_event_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"eve_cursor" bigint NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_event_receipts_cursor_nonnegative" CHECK ("conversation_event_receipts"."eve_cursor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"role" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"block_id" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"step_index" integer,
	"first_eve_cursor" bigint,
	"last_eve_cursor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_role_allowed" CHECK ("conversation_messages"."role" IN ('USER', 'ASSISTANT', 'DELEGATION')),
	CONSTRAINT "conversation_messages_status_allowed" CHECK ("conversation_messages"."status" IN ('STREAMING', 'COMPLETED', 'STOPPED', 'HIDDEN')),
	CONSTRAINT "conversation_messages_sequence_positive" CHECK ("conversation_messages"."sequence" > 0),
	CONSTRAINT "conversation_messages_step_index_nonnegative" CHECK ("conversation_messages"."step_index" IS NULL OR "conversation_messages"."step_index" >= 0),
	CONSTRAINT "conversation_messages_cursors_nonnegative" CHECK (("conversation_messages"."first_eve_cursor" IS NULL OR "conversation_messages"."first_eve_cursor" >= 0) AND ("conversation_messages"."last_eve_cursor" IS NULL OR "conversation_messages"."last_eve_cursor" >= 0)),
	CONSTRAINT "conversation_messages_cursor_order" CHECK ("conversation_messages"."first_eve_cursor" IS NULL OR "conversation_messages"."last_eve_cursor" IS NULL OR "conversation_messages"."last_eve_cursor" >= "conversation_messages"."first_eve_cursor"),
	CONSTRAINT "conversation_messages_role_state_consistent" CHECK (("conversation_messages"."role" = 'ASSISTANT') OR ("conversation_messages"."status" = 'COMPLETED'))
);
--> statement-breakpoint
CREATE TABLE "conversation_state_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid,
	"eve_cursor" bigint NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"conversation_status" varchar(24),
	"turn_status" varchar(16),
	"public_error_code" varchar(64),
	"event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_state_events_cursor_nonnegative" CHECK ("conversation_state_events"."eve_cursor" >= 0),
	CONSTRAINT "conversation_state_events_conversation_status_allowed" CHECK ("conversation_state_events"."conversation_status" IS NULL OR "conversation_state_events"."conversation_status" IN ('STARTING', 'RUNNING', 'CANCELLING', 'WAITING', 'TERMINAL_FAILED', 'TERMINAL_COMPLETED')),
	CONSTRAINT "conversation_state_events_turn_status_allowed" CHECK ("conversation_state_events"."turn_status" IS NULL OR "conversation_state_events"."turn_status" IN ('SUBMITTING', 'RUNNING', 'CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "conversation_step_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"eve_turn_id" text NOT NULL,
	"step_index" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"cost_usd" numeric(20, 8),
	"eve_cursor" bigint NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_step_usages_step_index_nonnegative" CHECK ("conversation_step_usages"."step_index" >= 0),
	CONSTRAINT "conversation_step_usages_tokens_nonnegative" CHECK (("conversation_step_usages"."input_tokens" IS NULL OR "conversation_step_usages"."input_tokens" >= 0) AND ("conversation_step_usages"."output_tokens" IS NULL OR "conversation_step_usages"."output_tokens" >= 0) AND ("conversation_step_usages"."cache_read_tokens" IS NULL OR "conversation_step_usages"."cache_read_tokens" >= 0) AND ("conversation_step_usages"."cache_write_tokens" IS NULL OR "conversation_step_usages"."cache_write_tokens" >= 0)),
	CONSTRAINT "conversation_step_usages_cost_nonnegative" CHECK ("conversation_step_usages"."cost_usd" IS NULL OR "conversation_step_usages"."cost_usd" >= 0),
	CONSTRAINT "conversation_step_usages_cursor_nonnegative" CHECK ("conversation_step_usages"."eve_cursor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "input_message_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "retry_of_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "kind" varchar(16) DEFAULT 'MAIN' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "title" varchar(240) DEFAULT '新对话' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "parent_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "parent_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "delegation_call_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "subagent_name" varchar(120);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "link_status" varchar(24) DEFAULT 'NOT_APPLICABLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "parent_called_cursor" bigint;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "child_started_cursor" bigint;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "next_message_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turns_tenant_conversation_id_unique" ON "conversation_turns" USING btree ("tenant_id","conversation_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_tenant_owner_identity_unique" ON "conversations" USING btree ("tenant_id","id","owner_user_id","owner_source");--> statement-breakpoint
ALTER TABLE "conversation_action_audits" ADD CONSTRAINT "conversation_action_audits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_action_audits" ADD CONSTRAINT "conversation_action_audits_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_action_audits" ADD CONSTRAINT "conversation_action_audits_tenant_turn_fk" FOREIGN KEY ("tenant_id","conversation_id","turn_id") REFERENCES "public"."conversation_turns"("tenant_id","conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_event_receipts" ADD CONSTRAINT "conversation_event_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_event_receipts" ADD CONSTRAINT "conversation_event_receipts_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_tenant_turn_fk" FOREIGN KEY ("tenant_id","conversation_id","turn_id") REFERENCES "public"."conversation_turns"("tenant_id","conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_state_events" ADD CONSTRAINT "conversation_state_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_state_events" ADD CONSTRAINT "conversation_state_events_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_state_events" ADD CONSTRAINT "conversation_state_events_tenant_turn_fk" FOREIGN KEY ("tenant_id","conversation_id","turn_id") REFERENCES "public"."conversation_turns"("tenant_id","conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_step_usages" ADD CONSTRAINT "conversation_step_usages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_step_usages" ADD CONSTRAINT "conversation_step_usages_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_step_usages" ADD CONSTRAINT "conversation_step_usages_tenant_turn_fk" FOREIGN KEY ("tenant_id","conversation_id","turn_id") REFERENCES "public"."conversation_turns"("tenant_id","conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_action_audits_call_unique" ON "conversation_action_audits" USING btree ("conversation_id","call_id");--> statement-breakpoint
CREATE INDEX "conversation_action_audits_turn_index" ON "conversation_action_audits" USING btree ("tenant_id","conversation_id","turn_id","step_index");--> statement-breakpoint
CREATE INDEX "conversation_action_audits_status_index" ON "conversation_action_audits" USING btree ("tenant_id","status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_event_receipts_cursor_unique" ON "conversation_event_receipts" USING btree ("conversation_id","eve_cursor");--> statement-breakpoint
CREATE INDEX "conversation_event_receipts_tenant_time_index" ON "conversation_event_receipts" USING btree ("tenant_id","event_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_sequence_unique" ON "conversation_messages" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_block_unique" ON "conversation_messages" USING btree ("conversation_id","block_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_history_index" ON "conversation_messages" USING btree ("tenant_id","conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "conversation_messages_turn_index" ON "conversation_messages" USING btree ("conversation_id","turn_id","sequence");--> statement-breakpoint
CREATE INDEX "conversation_messages_user_nodes_index" ON "conversation_messages" USING btree ("conversation_id","role","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_state_events_cursor_unique" ON "conversation_state_events" USING btree ("conversation_id","eve_cursor");--> statement-breakpoint
CREATE INDEX "conversation_state_events_history_index" ON "conversation_state_events" USING btree ("tenant_id","conversation_id","eve_cursor");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_step_usages_eve_step_unique" ON "conversation_step_usages" USING btree ("conversation_id","eve_turn_id","step_index");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_step_usages_turn_step_unique" ON "conversation_step_usages" USING btree ("turn_id","step_index");--> statement-breakpoint
CREATE INDEX "conversation_step_usages_conversation_index" ON "conversation_step_usages" USING btree ("tenant_id","conversation_id","event_at");--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_retry_fk" FOREIGN KEY ("tenant_id","conversation_id","retry_of_turn_id") REFERENCES "public"."conversation_turns"("tenant_id","conversation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_parent_turn_id_conversation_turns_id_fk" FOREIGN KEY ("parent_turn_id") REFERENCES "public"."conversation_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_parent_owner_identity_fk" FOREIGN KEY ("tenant_id","parent_conversation_id","owner_user_id","owner_source") REFERENCES "public"."conversations"("tenant_id","id","owner_user_id","owner_source") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_turns_input_message_index" ON "conversation_turns" USING btree ("input_message_id");--> statement-breakpoint
CREATE INDEX "conversation_turns_retry_index" ON "conversation_turns" USING btree ("retry_of_turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_parent_delegation_unique" ON "conversations" USING btree ("parent_conversation_id","delegation_call_id");--> statement-breakpoint
CREATE INDEX "conversations_owner_listing_index" ON "conversations" USING btree ("tenant_id","owner_user_id","owner_source","kind","archived_at","updated_at","id");--> statement-breakpoint
CREATE INDEX "conversations_parent_index" ON "conversations" USING btree ("tenant_id","parent_conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_retry_not_self" CHECK ("conversation_turns"."retry_of_turn_id" IS NULL OR "conversation_turns"."retry_of_turn_id" <> "conversation_turns"."id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_allowed" CHECK ("conversations"."kind" IN ('MAIN', 'SUBAGENT'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_link_status_allowed" CHECK ("conversations"."link_status" IN ('NOT_APPLICABLE', 'PENDING', 'VERIFIED', 'FAILED'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_fields_consistent" CHECK (("conversations"."kind" = 'MAIN' AND "conversations"."parent_conversation_id" IS NULL AND "conversations"."parent_turn_id" IS NULL AND "conversations"."delegation_call_id" IS NULL AND "conversations"."subagent_name" IS NULL AND "conversations"."link_status" = 'NOT_APPLICABLE' AND "conversations"."parent_called_cursor" IS NULL AND "conversations"."child_started_cursor" IS NULL) OR ("conversations"."kind" = 'SUBAGENT' AND "conversations"."parent_conversation_id" IS NOT NULL AND "conversations"."parent_turn_id" IS NOT NULL AND "conversations"."delegation_call_id" IS NOT NULL AND "conversations"."subagent_name" IS NOT NULL AND "conversations"."link_status" IN ('PENDING', 'VERIFIED', 'FAILED') AND "conversations"."archived_at" IS NULL));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_next_message_sequence_nonnegative" CHECK ("conversations"."next_message_sequence" >= 0);--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_link_cursors_nonnegative" CHECK (("conversations"."parent_called_cursor" IS NULL OR "conversations"."parent_called_cursor" >= 0) AND ("conversations"."child_started_cursor" IS NULL OR "conversations"."child_started_cursor" >= 0));
