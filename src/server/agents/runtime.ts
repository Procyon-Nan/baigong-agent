import { and, asc, eq } from "drizzle-orm";
import { getDatabase } from "@/src/server/db/client";
import {
  agentConfigVersions,
  agentConfigVersionSkills,
  agentConfigVersionTools,
  skillVersions,
} from "@/src/server/db/schema";
import { agentConfigurationFailure } from "./provisioning";
import {
  isDynamicAgentToolId,
  type DynamicAgentToolId,
} from "./registry";

export type AgentSkillVersion = {
  readonly skillId: string;
  readonly versionId: string;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly markdown: string;
};

export type ResolvedAgentCapabilities = {
  readonly agentId: string;
  readonly configVersionId: string;
  readonly version: number;
  readonly toolIds: readonly DynamicAgentToolId[];
  readonly skills: readonly AgentSkillVersion[];
};

type CapabilityReader = Pick<ReturnType<typeof getDatabase>, "select">;

export async function resolveAgentCapabilityVersion(
  tenantId: string,
  configVersionId: string,
): Promise<ResolvedAgentCapabilities> {
  return resolveAgentCapabilityVersionFrom(
    getDatabase(),
    tenantId,
    configVersionId,
  );
}

export async function resolveAgentCapabilityVersionFrom(
  database: CapabilityReader,
  tenantId: string,
  configVersionId: string,
): Promise<ResolvedAgentCapabilities> {
  const [version] = await database
    .select({
      agentId: agentConfigVersions.agentId,
      configVersionId: agentConfigVersions.id,
      version: agentConfigVersions.version,
    })
    .from(agentConfigVersions)
    .where(
      and(
        eq(agentConfigVersions.tenantId, tenantId),
        eq(agentConfigVersions.id, configVersionId),
      ),
    )
    .limit(1);
  if (!version) throw agentConfigurationFailure();

  const [toolRows, skillRows] = await Promise.all([
    database
      .select({ toolId: agentConfigVersionTools.toolId })
      .from(agentConfigVersionTools)
      .where(
        and(
          eq(agentConfigVersionTools.tenantId, tenantId),
          eq(agentConfigVersionTools.configVersionId, configVersionId),
        ),
      )
      .orderBy(asc(agentConfigVersionTools.toolId)),
    database
      .select({
        skillId: skillVersions.skillId,
        versionId: skillVersions.id,
        version: skillVersions.version,
        name: skillVersions.name,
        description: skillVersions.description,
        markdown: skillVersions.markdown,
      })
      .from(agentConfigVersionSkills)
      .innerJoin(
        skillVersions,
        and(
          eq(skillVersions.tenantId, agentConfigVersionSkills.tenantId),
          eq(skillVersions.id, agentConfigVersionSkills.skillVersionId),
        ),
      )
      .where(
        and(
          eq(agentConfigVersionSkills.tenantId, tenantId),
          eq(agentConfigVersionSkills.configVersionId, configVersionId),
        ),
      )
      .orderBy(asc(skillVersions.name), asc(skillVersions.id)),
  ]);
  const toolIds = toolRows.map(({ toolId }) => {
    if (!isDynamicAgentToolId(toolId)) throw agentConfigurationFailure();
    return toolId;
  });
  return { ...version, toolIds, skills: skillRows };
}
