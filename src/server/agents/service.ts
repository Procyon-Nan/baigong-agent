import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import {
  assertAdminPrincipal,
  type AdminPrincipal,
} from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import {
  agentConfigurations,
  agentConfigVersions,
  agentConfigVersionSkills,
  agentConfigVersionTools,
  skillConfigurations,
  skills,
  skillVersions,
} from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import {
  agentConfigurationFailure,
  ensureMainAgentConfiguration,
  lockTenantCapabilities,
  type CapabilityTransaction,
  type MainAgentConfiguration,
} from "./provisioning";
import {
  dynamicToolRegistry,
  FIXED_AGENT_TOOLS,
  FIXED_DISABLED_AGENT_TOOLS,
  isDynamicAgentToolId,
  MAIN_AGENT_STABLE_KEY,
  type DynamicAgentToolId,
} from "./registry";
import { resolveAgentCapabilityVersionFrom } from "./runtime";

export type AdminAgentCapabilities = {
  readonly agent: {
    readonly id: string;
    readonly stableKey: typeof MAIN_AGENT_STABLE_KEY;
    readonly versionId: string;
    readonly version: number;
  };
  readonly fixedTools: typeof FIXED_AGENT_TOOLS;
  readonly fixedDisabledTools: typeof FIXED_DISABLED_AGENT_TOOLS;
  readonly dynamicTools: readonly (typeof dynamicToolRegistry)[number][];
  readonly enabledToolIds: readonly DynamicAgentToolId[];
  readonly skills: readonly {
    readonly id: string;
    readonly versionId: string;
    readonly version: number;
    readonly name: string;
    readonly description: string;
    readonly createdSource: "SYSTEM" | "ADMIN" | "AGENT";
    readonly enabled: boolean;
    readonly updatedAt: Date;
  }[];
  readonly updatedAt: Date;
  readonly updatedByUserId: string | null;
};

export async function lockCurrentAgentConfigurationVersion(
  transaction: CapabilityTransaction,
  tenantId: string,
): Promise<MainAgentConfiguration> {
  return ensureMainAgentConfiguration(transaction, tenantId);
}

export async function getCurrentAgentCapabilities(
  actor: AdminPrincipal,
): Promise<AdminAgentCapabilities> {
  assertAdminPrincipal(actor);
  return getDatabase().transaction(async (transaction) => {
    const current = await ensureMainAgentConfiguration(
      transaction,
      actor.tenantId,
    );
    const resolved = await resolveAgentCapabilityVersionFrom(
      transaction,
      actor.tenantId,
      current.configVersionId,
    );
    const [pointer] = await transaction
      .select({
        updatedAt: agentConfigurations.updatedAt,
        updatedByUserId: agentConfigurations.updatedByUserId,
      })
      .from(agentConfigurations)
      .where(eq(agentConfigurations.agentId, current.agentId))
      .limit(1);
    if (!pointer) throw agentConfigurationFailure();

    const currentSkills = await listCurrentSkillVersions(
      transaction,
      actor.tenantId,
    );
    const enabled = new Set(resolved.skills.map(({ versionId }) => versionId));
    return {
      agent: {
        id: current.agentId,
        stableKey: MAIN_AGENT_STABLE_KEY,
        versionId: current.configVersionId,
        version: current.version,
      },
      fixedTools: FIXED_AGENT_TOOLS,
      fixedDisabledTools: FIXED_DISABLED_AGENT_TOOLS,
      dynamicTools: dynamicToolRegistry,
      enabledToolIds: resolved.toolIds,
      skills: currentSkills.map((skill) => ({
        id: skill.skillId,
        versionId: skill.versionId,
        version: skill.version,
        name: skill.name,
        description: skill.description,
        createdSource: skill.createdSource,
        enabled: enabled.has(skill.versionId),
        updatedAt: skill.updatedAt,
      })),
      updatedAt: pointer.updatedAt,
      updatedByUserId: pointer.updatedByUserId,
    };
  });
}

export async function saveAgentCapabilities(
  actor: AdminPrincipal,
  input: {
    readonly toolIds: readonly string[];
    readonly skillVersionIds: readonly string[];
  },
): Promise<AdminAgentCapabilities> {
  assertAdminPrincipal(actor);
  await getDatabase().transaction(async (transaction) => {
    await lockTenantCapabilities(transaction, actor.tenantId);
    const current = await ensureMainAgentConfiguration(
      transaction,
      actor.tenantId,
    );
    const toolIds = normalizeToolIds(input.toolIds);
    const skillVersionIds = await validateCurrentSkillVersionIds(
      transaction,
      actor.tenantId,
      input.skillVersionIds,
    );
    const currentSet = await resolveAgentCapabilityVersionFrom(
      transaction,
      actor.tenantId,
      current.configVersionId,
    );
    if (
      equalSets(currentSet.toolIds, toolIds) &&
      equalSets(
        currentSet.skills.map(({ versionId }) => versionId),
        skillVersionIds,
      )
    ) {
      return;
    }

    const created = await createCapabilityVersion(transaction, {
      tenantId: actor.tenantId,
      agentId: current.agentId,
      previousVersion: current.version,
      toolIds,
      skillVersionIds,
      actorUserId: actor.userId,
    });
    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: "AGENT_CAPABILITIES_UPDATED",
      targetType: "AGENT",
      targetId: current.agentId,
      outcome: "SUCCESS",
      metadata: {
        version: created.version,
        toolIds: toolIds.join(","),
        skillVersionIds: skillVersionIds.join(","),
      },
    });
  });
  return getCurrentAgentCapabilities(actor);
}

export async function replaceEnabledSkillVersion(
  transaction: CapabilityTransaction,
  input: {
    readonly actor: AdminPrincipal;
    readonly skillId: string;
    readonly newSkillVersionId: string;
  },
): Promise<number | null> {
  await lockTenantCapabilities(transaction, input.actor.tenantId);
  const current = await ensureMainAgentConfiguration(
    transaction,
    input.actor.tenantId,
  );
  const currentSet = await resolveAgentCapabilityVersionFrom(
    transaction,
    input.actor.tenantId,
    current.configVersionId,
  );
  const enabledVersion = currentSet.skills.find(
    (skill) => skill.skillId === input.skillId,
  );
  if (!enabledVersion) return null;

  const skillVersionIds = currentSet.skills
    .map(({ skillId, versionId }) =>
      skillId === input.skillId ? input.newSkillVersionId : versionId,
    )
    .sort();
  const created = await createCapabilityVersion(transaction, {
    tenantId: input.actor.tenantId,
    agentId: current.agentId,
    previousVersion: current.version,
    toolIds: currentSet.toolIds,
    skillVersionIds,
    actorUserId: input.actor.userId,
  });
  return created.version;
}

async function listCurrentSkillVersions(
  transaction: CapabilityTransaction,
  tenantId: string,
) {
  return transaction
    .select({
      skillId: skills.id,
      versionId: skillVersions.id,
      version: skillVersions.version,
      name: skillVersions.name,
      description: skillVersions.description,
      createdSource: skills.createdSource,
      updatedAt: skills.updatedAt,
    })
    .from(skills)
    .innerJoin(
      skillConfigurations,
      and(
        eq(skillConfigurations.tenantId, skills.tenantId),
        eq(skillConfigurations.skillId, skills.id),
      ),
    )
    .innerJoin(
      skillVersions,
      and(
        eq(skillVersions.tenantId, skillConfigurations.tenantId),
        eq(skillVersions.id, skillConfigurations.currentVersionId),
      ),
    )
    .where(eq(skills.tenantId, tenantId))
    .orderBy(asc(skills.name));
}

function normalizeToolIds(values: readonly string[]): DynamicAgentToolId[] {
  const unique = [...new Set(values)];
  if (
    unique.length !== values.length ||
    unique.some((id) => !isDynamicAgentToolId(id))
  ) {
    throw invalidAgentCapabilities();
  }
  return unique.sort() as DynamicAgentToolId[];
}

async function validateCurrentSkillVersionIds(
  transaction: CapabilityTransaction,
  tenantId: string,
  values: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(values)].sort();
  if (unique.length !== values.length) throw invalidAgentCapabilities();
  if (unique.length === 0) return unique;
  const rows = await transaction
    .select({ versionId: skillConfigurations.currentVersionId })
    .from(skillConfigurations)
    .where(
      and(
        eq(skillConfigurations.tenantId, tenantId),
        inArray(skillConfigurations.currentVersionId, unique),
      ),
    );
  if (!equalSets(rows.map(({ versionId }) => versionId), unique)) {
    throw invalidAgentCapabilities();
  }
  return unique;
}

async function createCapabilityVersion(
  transaction: CapabilityTransaction,
  input: {
    readonly tenantId: string;
    readonly agentId: string;
    readonly previousVersion: number;
    readonly toolIds: readonly DynamicAgentToolId[];
    readonly skillVersionIds: readonly string[];
    readonly actorUserId: string;
  },
): Promise<{ readonly id: string; readonly version: number }> {
  const [latest] = await transaction
    .select({ version: agentConfigVersions.version })
    .from(agentConfigVersions)
    .where(
      and(
        eq(agentConfigVersions.tenantId, input.tenantId),
        eq(agentConfigVersions.agentId, input.agentId),
      ),
    )
    .orderBy(desc(agentConfigVersions.version))
    .limit(1);
  if (!latest || latest.version !== input.previousVersion) {
    throw agentConfigurationFailure();
  }
  const version = latest.version + 1;
  const [created] = await transaction
    .insert(agentConfigVersions)
    .values({
      tenantId: input.tenantId,
      agentId: input.agentId,
      version,
      createdByUserId: input.actorUserId,
    })
    .returning({ id: agentConfigVersions.id });
  if (!created) throw agentConfigurationFailure();
  if (input.toolIds.length > 0) {
    await transaction.insert(agentConfigVersionTools).values(
      input.toolIds.map((toolId) => ({
        tenantId: input.tenantId,
        configVersionId: created.id,
        toolId,
      })),
    );
  }
  if (input.skillVersionIds.length > 0) {
    await transaction.insert(agentConfigVersionSkills).values(
      input.skillVersionIds.map((skillVersionId) => ({
        tenantId: input.tenantId,
        configVersionId: created.id,
        skillVersionId,
      })),
    );
  }
  await transaction
    .update(agentConfigurations)
    .set({
      currentVersionId: created.id,
      updatedByUserId: input.actorUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentConfigurations.tenantId, input.tenantId),
        eq(agentConfigurations.agentId, input.agentId),
      ),
    );
  return { id: created.id, version };
}

function equalSets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function invalidAgentCapabilities(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_AGENT_CAPABILITIES",
    message: "Agent 能力配置无效。",
    status: 400,
    expose: true,
  });
}
