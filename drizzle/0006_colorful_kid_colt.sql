CREATE TABLE "conversation_ui_states" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"todos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"todo_eve_cursor" bigint,
	"pending_input" jsonb,
	"input_eve_cursor" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_ui_states_todo_cursor_nonnegative" CHECK ("conversation_ui_states"."todo_eve_cursor" IS NULL OR "conversation_ui_states"."todo_eve_cursor" >= 0),
	CONSTRAINT "conversation_ui_states_input_cursor_nonnegative" CHECK ("conversation_ui_states"."input_eve_cursor" IS NULL OR "conversation_ui_states"."input_eve_cursor" >= 0),
	CONSTRAINT "conversation_ui_states_todo_cursor_consistent" CHECK (("conversation_ui_states"."todo_eve_cursor" IS NULL AND "conversation_ui_states"."todos" = '[]'::jsonb) OR "conversation_ui_states"."todo_eve_cursor" IS NOT NULL),
	CONSTRAINT "conversation_ui_states_input_cursor_consistent" CHECK (("conversation_ui_states"."pending_input" IS NULL AND "conversation_ui_states"."input_eve_cursor" IS NULL) OR ("conversation_ui_states"."pending_input" IS NOT NULL AND "conversation_ui_states"."input_eve_cursor" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "conversation_ui_states" ADD CONSTRAINT "conversation_ui_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_ui_states" ADD CONSTRAINT "conversation_ui_states_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_ui_states_tenant_conversation_unique" ON "conversation_ui_states" USING btree ("tenant_id","conversation_id");