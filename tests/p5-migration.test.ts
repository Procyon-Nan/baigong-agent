import "dotenv/config";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { configureP5TestDatabase } from "./support/p5-test-database";

const databaseUrl = configureP5TestDatabase();

describe("P5 forward migration", () => {
  it("backfills an existing P4 tenant and historical turn", async () => {
    const client = new Client({ connectionString: databaseUrl });
    const schema = `p5_migration_${randomUUID().replaceAll("-", "")}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      for (const file of [
        "drizzle/0000_silky_black_crow.sql",
        "drizzle/0001_luxuriant_viper.sql",
        "drizzle/0002_plain_sleepwalker.sql",
        "drizzle/0003_p4_conversation_history.sql",
      ]) {
        await applyMigration(client, schema, file);
      }
      const tenantId = randomUUID();
      const userId = `migration-user-${randomUUID()}`;
      const modelVersionId = randomUUID();
      const conversationId = randomUUID();
      const turnId = randomUUID();
      const childConversationId = randomUUID();
      const childTurnId = randomUUID();
      const delegationCallId = `call-${randomUUID()}`;
      await client.query(
        `INSERT INTO tenants (id, slug, display_name) VALUES ($1, $2, 'Migration Tenant')`,
        [tenantId, `migration-${randomUUID()}`],
      );
      await client.query(
        `INSERT INTO auth_users (id, name, email) VALUES ($1, 'Migration User', $2)`,
        [userId, `${randomUUID()}@example.com`],
      );
      await client.query(
        `INSERT INTO user_profiles (user_id, tenant_id, source, role, status, display_name) VALUES ($1, $2, 'LOCAL', 'ADMIN', 'ACTIVE', 'Migration User')`,
        [userId, tenantId],
      );
      await client.query(
        `INSERT INTO model_config_versions (id, tenant_id, version, provider_display_name, base_url, model_name) VALUES ($1, $2, 1, 'Migration Provider', 'http://127.0.0.1:41999/v1', 'migration-model')`,
        [modelVersionId, tenantId],
      );
      await client.query(
        `INSERT INTO conversations (id, tenant_id, owner_user_id, owner_source, kind, title, link_status, agent_id, status, next_message_sequence) VALUES ($1, $2, $3, 'LOCAL', 'MAIN', '历史会话', 'NOT_APPLICABLE', 'main', 'WAITING', 0)`,
        [conversationId, tenantId, userId],
      );
      await client.query(
        `INSERT INTO conversation_turns (id, tenant_id, conversation_id, owner_user_id, request_id, model_config_version_id, status) VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED')`,
        [turnId, tenantId, conversationId, userId, randomUUID(), modelVersionId],
      );

      await applyMigration(client, schema, "drizzle/0004_mixed_maelstrom.sql");
      await applyMigration(client, schema, "drizzle/0005_new_vampiro.sql");
      await applyMigration(client, schema, "drizzle/0006_colorful_kid_colt.sql");
      await applyMigration(
        client,
        schema,
        "drizzle/0007_motionless_mattie_franklin.sql",
      );
      await applyMigration(client, schema, "drizzle/0008_wise_la_nuit.sql");
      await client.query(
        `UPDATE conversations SET last_eve_cursor = 2 WHERE id = $1`,
        [conversationId],
      );
      await client.query(
        `UPDATE conversation_turns SET eve_turn_id = 'parent-eve-turn' WHERE id = $1`,
        [turnId],
      );
      await client.query(
        `INSERT INTO conversations (id, tenant_id, owner_user_id, owner_source, kind, title, parent_conversation_id, parent_turn_id, delegation_call_id, subagent_name, link_status, parent_called_cursor, agent_id, eve_session_id, status, active_turn_id, next_message_sequence) VALUES ($1, $2, $3, 'LOCAL', 'SUBAGENT', 'worker', $4, $5, $6, 'worker', 'PENDING', 2, 'worker', $7, 'STARTING', $8, 0)`,
        [
          childConversationId,
          tenantId,
          userId,
          conversationId,
          turnId,
          delegationCallId,
          `child-${randomUUID()}`,
          childTurnId,
        ],
      );
      await client.query(
        `INSERT INTO conversation_turns (id, tenant_id, conversation_id, owner_user_id, request_id, model_config_version_id, agent_config_version_id, status) SELECT $1, tenant_id, $2, owner_user_id, $3, model_config_version_id, agent_config_version_id, 'SUBMITTING' FROM conversation_turns WHERE id = $4`,
        [childTurnId, childConversationId, randomUUID(), turnId],
      );
      await client.query(
        `INSERT INTO conversation_action_audits (tenant_id, conversation_id, turn_id, eve_turn_id, step_index, call_id, action_type, action_name, status, request_eve_cursor, result_eve_cursor, error_code, started_at, completed_at) VALUES ($1, $2, $3, 'parent-eve-turn', 0, $4, 'SUBAGENT', 'worker', 'FAILED', 1, 2, 'SUBAGENT_EXECUTION_FAILED', now(), now())`,
        [tenantId, conversationId, turnId, delegationCallId],
      );
      await applyMigration(client, schema, "drizzle/0009_clever_wiccan.sql");
      const turn = await client.query(
        `SELECT agent_config_version_id FROM conversation_turns WHERE id = $1`,
        [turnId],
      );
      const versions = await client.query(
        `SELECT version FROM agent_config_versions WHERE tenant_id = $1 ORDER BY version`,
        [tenantId],
      );
      const tools = await client.query(
        `SELECT tool_id FROM agent_config_version_tools WHERE tenant_id = $1 ORDER BY tool_id`,
        [tenantId],
      );
      const indexes = await client.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname IN ('conversation_action_audits_call_unique', 'conversation_action_audits_turn_step_call_unique', 'conversation_action_audits_request_call_unique', 'conversations_parent_delegation_unique', 'conversations_parent_called_cursor_unique') ORDER BY indexname`,
        [schema],
      );
      const uiStateTable = await client.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'conversation_ui_states') AS present`,
        [schema],
      );
      const usageIndexes = await client.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'conversation_step_usages' AND indexname LIKE 'conversation_step_usages_%_unique' ORDER BY indexname`,
        [schema],
      );
      const projectionState = await client.query(
        `SELECT last_eve_cursor, failure_count FROM conversation_derived_projection_states WHERE conversation_id = $1`,
        [conversationId],
      );
      const repairedChild = await client.query(
        `SELECT status, link_status, active_turn_id FROM conversations WHERE id = $1`,
        [childConversationId],
      );
      const repairedChildTurn = await client.query(
        `SELECT status, public_error_code FROM conversation_turns WHERE id = $1`,
        [childTurnId],
      );
      expect(turn.rows[0]?.agent_config_version_id).toBeTruthy();
      expect(versions.rows.map(({ version }) => version)).toEqual([1, 2]);
      expect(tools.rows.map(({ tool_id }) => tool_id)).toEqual([
        "list_conversation_attachments",
        "read_conversation_attachment",
        "todo",
      ]);
      expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
        "conversation_action_audits_request_call_unique",
        "conversations_parent_called_cursor_unique",
      ]);
      expect(uiStateTable.rows[0]?.present).toBe(true);
      expect(usageIndexes.rows.map(({ indexname }) => indexname)).toEqual([
        "conversation_step_usages_cursor_unique",
      ]);
      expect(projectionState.rows).toEqual([
        { last_eve_cursor: "2", failure_count: 0 },
      ]);
      expect(repairedChild.rows).toEqual([
        {
          status: "TERMINAL_FAILED",
          link_status: "FAILED",
          active_turn_id: null,
        },
      ]);
      expect(repairedChildTurn.rows).toEqual([
        { status: "FAILED", public_error_code: "REQUEST_FAILED" },
      ]);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  }, 60_000);
});

async function applyMigration(
  client: Client,
  schema: string,
  path: string,
): Promise<void> {
  const sql = (await readFile(path, "utf8")).replaceAll(
    '"public".',
    `"${schema}".`,
  );
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}
