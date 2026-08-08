DROP INDEX "conversation_step_usages_eve_step_unique";--> statement-breakpoint
DROP INDEX "conversation_step_usages_turn_step_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_step_usages_cursor_unique" ON "conversation_step_usages" USING btree ("conversation_id","eve_cursor");