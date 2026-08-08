CREATE TABLE "conversation_derived_projection_states" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"last_eve_cursor" bigint,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure_code" varchar(64),
	"last_failure_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_derived_projection_cursor_nonnegative" CHECK ("conversation_derived_projection_states"."last_eve_cursor" IS NULL OR "conversation_derived_projection_states"."last_eve_cursor" >= 0),
	CONSTRAINT "conversation_derived_projection_failure_count_nonnegative" CHECK ("conversation_derived_projection_states"."failure_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "conversation_derived_projection_states" ADD CONSTRAINT "conversation_derived_projection_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_derived_projection_states" ADD CONSTRAINT "conversation_derived_projection_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_derived_projection_lag_index" ON "conversation_derived_projection_states" USING btree ("tenant_id","last_eve_cursor");--> statement-breakpoint
INSERT INTO "conversation_derived_projection_states" (
	"conversation_id",
	"tenant_id",
	"last_eve_cursor",
	"updated_at"
)
SELECT "id", "tenant_id", "last_eve_cursor", now()
FROM "conversations";--> statement-breakpoint
UPDATE "conversation_turns" AS "child_turn"
SET
	"status" = 'FAILED',
	"public_error_code" = 'REQUEST_FAILED',
	"completed_at" = COALESCE("failed_action"."completed_at", now()),
	"updated_at" = now()
FROM "conversations" AS "child"
INNER JOIN "conversation_action_audits" AS "failed_action"
	ON "failed_action"."conversation_id" = "child"."parent_conversation_id"
	AND "failed_action"."turn_id" = "child"."parent_turn_id"
	AND "failed_action"."call_id" = "child"."delegation_call_id"
	AND "failed_action"."request_eve_cursor" < "child"."parent_called_cursor"
	AND "failed_action"."action_type" = 'SUBAGENT'
	AND "failed_action"."status" IN ('FAILED', 'REJECTED')
WHERE "child"."kind" = 'SUBAGENT'
	AND "child"."link_status" = 'PENDING'
	AND "child"."active_turn_id" = "child_turn"."id"
	AND "child_turn"."status" IN ('SUBMITTING', 'RUNNING', 'CANCELLING');--> statement-breakpoint
UPDATE "conversations" AS "child"
SET
	"link_status" = 'FAILED',
	"status" = 'TERMINAL_FAILED',
	"active_turn_id" = NULL,
	"encrypted_continuation_token" = NULL,
	"updated_at" = now()
WHERE "child"."kind" = 'SUBAGENT'
	AND "child"."link_status" = 'PENDING'
	AND EXISTS (
		SELECT 1
		FROM "conversation_action_audits" AS "failed_action"
		WHERE "failed_action"."conversation_id" = "child"."parent_conversation_id"
			AND "failed_action"."turn_id" = "child"."parent_turn_id"
			AND "failed_action"."call_id" = "child"."delegation_call_id"
			AND "failed_action"."request_eve_cursor" < "child"."parent_called_cursor"
			AND "failed_action"."action_type" = 'SUBAGENT'
			AND "failed_action"."status" IN ('FAILED', 'REJECTED')
	);
