import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/src/server/db/client";
import {
  agentConfigurations,
  agentConfigVersions,
  agentConfigVersionSkills,
  agentConfigVersionTools,
  agents,
  skillConfigurations,
  skills,
  skillVersions,
} from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import {
  defaultDynamicToolIds,
  MAIN_AGENT_STABLE_KEY,
} from "./registry";
import {
  EVIDENCE_RESEARCH_SKILL_DESCRIPTION,
  EVIDENCE_RESEARCH_SKILL_MARKDOWN,
  EVIDENCE_RESEARCH_SKILL_NAME,
} from "@/src/server/skills/system";

export type CapabilityTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export type MainAgentConfiguration = {
  readonly agentId: string;
  readonly configVersionId: string;
  readonly version: number;
};

export async function lockTenantCapabilities(
  transaction: CapabilityTransaction,
  tenantId: string,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`agent-capabilities:${tenantId}`}))`,
  );
}

export async function ensureMainAgentConfiguration(
  transaction: CapabilityTransaction,
  tenantId: string,
): Promise<MainAgentConfiguration> {
  await lockTenantCapabilities(transaction, tenantId);
  const existing = await findMainAgentConfiguration(transaction, tenantId);
  if (existing) return existing;

  const skillVersionId = await ensureEvidenceResearchSkill(transaction, tenantId);
  const agentId = randomUUID();
  const baselineVersionId = randomUUID();
  const defaultVersionId = randomUUID();
  const now = new Date();

  await transaction.insert(agents).values({
    id: agentId,
    tenantId,
    stableKey: MAIN_AGENT_STABLE_KEY,
    isMain: true,
    createdAt: now,
  });
  await transaction.insert(agentConfigVersions).values([
    {
      id: baselineVersionId,
      tenantId,
      agentId,
      version: 1,
      createdAt: now,
    },
    {
      id: defaultVersionId,
      tenantId,
      agentId,
      version: 2,
      createdAt: now,
    },
  ]);
  await transaction.insert(agentConfigVersionTools).values(
    defaultDynamicToolIds().map((toolId) => ({
      tenantId,
      configVersionId: defaultVersionId,
      toolId,
    })),
  );
  await transaction.insert(agentConfigVersionSkills).values({
    tenantId,
    configVersionId: defaultVersionId,
    skillVersionId,
  });
  await transaction.insert(agentConfigurations).values({
    agentId,
    tenantId,
    currentVersionId: defaultVersionId,
    updatedAt: now,
  });
  return { agentId, configVersionId: defaultVersionId, version: 2 };
}

export async function findMainAgentConfiguration(
  transaction: CapabilityTransaction,
  tenantId: string,
): Promise<MainAgentConfiguration | null> {
  const [configuration] = await transaction
    .select({
      agentId: agents.id,
      configVersionId: agentConfigVersions.id,
      version: agentConfigVersions.version,
    })
    .from(agents)
    .innerJoin(
      agentConfigurations,
      and(
        eq(agentConfigurations.tenantId, agents.tenantId),
        eq(agentConfigurations.agentId, agents.id),
      ),
    )
    .innerJoin(
      agentConfigVersions,
      and(
        eq(agentConfigVersions.tenantId, agentConfigurations.tenantId),
        eq(agentConfigVersions.id, agentConfigurations.currentVersionId),
        eq(agentConfigVersions.agentId, agents.id),
      ),
    )
    .where(
      and(
        eq(agents.tenantId, tenantId),
        eq(agents.stableKey, MAIN_AGENT_STABLE_KEY),
        eq(agents.isMain, true),
      ),
    )
    .limit(1);
  return configuration ?? null;
}

async function ensureEvidenceResearchSkill(
  transaction: CapabilityTransaction,
  tenantId: string,
): Promise<string> {
  const [existing] = await transaction
    .select({ versionId: skillConfigurations.currentVersionId })
    .from(skills)
    .innerJoin(
      skillConfigurations,
      and(
        eq(skillConfigurations.tenantId, skills.tenantId),
        eq(skillConfigurations.skillId, skills.id),
      ),
    )
    .where(
      and(
        eq(skills.tenantId, tenantId),
        eq(skills.name, EVIDENCE_RESEARCH_SKILL_NAME),
      ),
    )
    .limit(1);
  if (existing) return existing.versionId;

  const skillId = randomUUID();
  const versionId = randomUUID();
  const now = new Date();
  await transaction.insert(skills).values({
    id: skillId,
    tenantId,
    name: EVIDENCE_RESEARCH_SKILL_NAME,
    createdSource: "SYSTEM",
    createdAt: now,
    updatedAt: now,
  });
  await transaction.insert(skillVersions).values({
    id: versionId,
    tenantId,
    skillId,
    version: 1,
    name: EVIDENCE_RESEARCH_SKILL_NAME,
    description: EVIDENCE_RESEARCH_SKILL_DESCRIPTION,
    markdown: EVIDENCE_RESEARCH_SKILL_MARKDOWN,
    createdSource: "SYSTEM",
    createdAt: now,
  });
  await transaction.insert(skillConfigurations).values({
    skillId,
    tenantId,
    currentVersionId: versionId,
    updatedAt: now,
  });
  return versionId;
}

export function agentConfigurationFailure(cause?: unknown): ApplicationError {
  return new ApplicationError({
    code: "AGENT_CONFIGURATION_FAILURE",
    message: "Agent 能力配置暂时不可用。",
    cause,
  });
}
