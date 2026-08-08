DROP INDEX "conversations_parent_delegation_unique";--> statement-breakpoint
DROP INDEX "conversation_action_audits_call_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_parent_called_cursor_unique" ON "conversations" USING btree ("parent_conversation_id","parent_called_cursor");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_action_audits_turn_step_call_unique" ON "conversation_action_audits" USING btree ("conversation_id","eve_turn_id","step_index","call_id");