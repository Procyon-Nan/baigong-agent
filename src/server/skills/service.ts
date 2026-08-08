import "server-only";

import { and, asc, desc, eq, ne } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import {
  assertAdminPrincipal,
  type AdminPrincipal,
} from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import {
  skillConfigurations,
  skills,
  skillVersions,
} from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import type {
  CreateSkillRequest,
  UpdateSkillRequest,
} from "@/src/server/http/p5-agent-schemas";
import {
  ensureMainAgentConfiguration,
  lockTenantCapabilities,
  type CapabilityTransaction,
} from "@/src/server/agents/provisioning";
import {
  getCurrentAgentCapabilities,
  replaceEnabledSkillVersion,
} from "@/src/server/agents/service";

export type AdminSkill = {
  readonly id: string;
  readonly name: string;
  readonly createdSource: "SYSTEM" | "ADMIN" | "AGENT";
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly enabled: boolean;
  readonly currentVersion: {
    readonly id: string;
    readonly version: number;
    readonly name: string;
    readonly description: string;
    readonly markdown: string;
    readonly createdSource: "SYSTEM" | "ADMIN" | "AGENT";
    readonly createdAt: Date;
  };
  readonly versions: readonly {
    readonly id: string;
    readonly version: number;
    readonly name: string;
    readonly description: string;
    readonly createdSource: "SYSTEM" | "ADMIN" | "AGENT";
    readonly createdAt: Date;
  }[];
};

type MutableAdminSkill = Omit<AdminSkill, "versions"> & {
  readonly versions: AdminSkill["versions"][number][];
};

export async function listSkills(actor: AdminPrincipal): Promise<AdminSkill[]> {
  assertAdminPrincipal(actor);
  const capabilities = await getCurrentAgentCapabilities(actor);
  const enabledVersions = new Set(
    capabilities.skills.filter(({ enabled }) => enabled).map(({ versionId }) => versionId),
  );
  return listTenantSkills(actor.tenantId, enabledVersions);
}

export async function createSkill(
  actor: AdminPrincipal,
  input: CreateSkillRequest,
): Promise<AdminSkill> {
  assertAdminPrincipal(actor);
  const skillId = await getDatabase().transaction(async (transaction) => {
    await lockTenantCapabilities(transaction, actor.tenantId);
    await ensureMainAgentConfiguration(transaction, actor.tenantId);
    await assertSkillNameAvailable(transaction, actor.tenantId, input.name);
    const [skill] = await transaction
      .insert(skills)
      .values({
        tenantId: actor.tenantId,
        name: input.name,
        createdSource: "ADMIN",
        createdByUserId: actor.userId,
      })
      .returning({ id: skills.id });
    if (!skill) throw skillPersistenceFailure();
    const [version] = await transaction
      .insert(skillVersions)
      .values({
        tenantId: actor.tenantId,
        skillId: skill.id,
        version: 1,
        name: input.name,
        description: input.description,
        markdown: input.markdown,
        createdSource: "ADMIN",
        createdByUserId: actor.userId,
      })
      .returning({ id: skillVersions.id });
    if (!version) throw skillPersistenceFailure();
    await transaction.insert(skillConfigurations).values({
      skillId: skill.id,
      tenantId: actor.tenantId,
      currentVersionId: version.id,
      updatedByUserId: actor.userId,
    });
    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: "SKILL_CREATED",
      targetType: "SKILL",
      targetId: skill.id,
      outcome: "SUCCESS",
      metadata: { name: input.name, version: 1 },
    });
    return skill.id;
  });
  return findSkill(actor, skillId);
}

export async function updateSkill(
  actor: AdminPrincipal,
  skillId: string,
  input: UpdateSkillRequest,
): Promise<AdminSkill> {
  assertAdminPrincipal(actor);
  await getDatabase().transaction(async (transaction) => {
    await lockTenantCapabilities(transaction, actor.tenantId);
    const current = await findCurrentSkillForUpdate(
      transaction,
      actor.tenantId,
      skillId,
    );
    if (!current) throw skillNotFound();
    if (
      current.name === input.name &&
      current.description === input.description &&
      current.markdown === input.markdown
    ) {
      return;
    }
    if (current.name !== input.name) {
      await assertSkillNameAvailable(
        transaction,
        actor.tenantId,
        input.name,
        skillId,
      );
    }
    const [latest] = await transaction
      .select({ version: skillVersions.version })
      .from(skillVersions)
      .where(
        and(
          eq(skillVersions.tenantId, actor.tenantId),
          eq(skillVersions.skillId, skillId),
        ),
      )
      .orderBy(desc(skillVersions.version))
      .limit(1);
    if (!latest) throw skillPersistenceFailure();
    const nextVersion = latest.version + 1;
    const now = new Date();
    const [created] = await transaction
      .insert(skillVersions)
      .values({
        tenantId: actor.tenantId,
        skillId,
        version: nextVersion,
        name: input.name,
        description: input.description,
        markdown: input.markdown,
        createdSource: "ADMIN",
        createdByUserId: actor.userId,
        createdAt: now,
      })
      .returning({ id: skillVersions.id });
    if (!created) throw skillPersistenceFailure();
    await transaction
      .update(skills)
      .set({ name: input.name, updatedAt: now })
      .where(
        and(eq(skills.tenantId, actor.tenantId), eq(skills.id, skillId)),
      );
    await transaction
      .update(skillConfigurations)
      .set({
        currentVersionId: created.id,
        updatedByUserId: actor.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(skillConfigurations.tenantId, actor.tenantId),
          eq(skillConfigurations.skillId, skillId),
        ),
      );
    const agentVersion = await replaceEnabledSkillVersion(transaction, {
      actor,
      skillId,
      newSkillVersionId: created.id,
    });
    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: "SKILL_VERSION_CREATED",
      targetType: "SKILL",
      targetId: skillId,
      outcome: "SUCCESS",
      metadata: { name: input.name, version: nextVersion, agentVersion },
    });
  });
  return findSkill(actor, skillId);
}

async function findSkill(
  actor: AdminPrincipal,
  skillId: string,
): Promise<AdminSkill> {
  const skill = (await listSkills(actor)).find(({ id }) => id === skillId);
  if (!skill) throw skillNotFound();
  return skill;
}

async function listTenantSkills(
  tenantId: string,
  enabledVersions: ReadonlySet<string>,
): Promise<AdminSkill[]> {
  const database = getDatabase();
  const rows = await database
    .select({
      id: skills.id,
      name: skills.name,
      createdSource: skills.createdSource,
      createdAt: skills.createdAt,
      updatedAt: skills.updatedAt,
      currentVersionId: skillConfigurations.currentVersionId,
      versionId: skillVersions.id,
      version: skillVersions.version,
      versionName: skillVersions.name,
      description: skillVersions.description,
      markdown: skillVersions.markdown,
      versionCreatedSource: skillVersions.createdSource,
      versionCreatedAt: skillVersions.createdAt,
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
        eq(skillVersions.tenantId, skills.tenantId),
        eq(skillVersions.skillId, skills.id),
      ),
    )
    .where(eq(skills.tenantId, tenantId))
    .orderBy(asc(skills.name), desc(skillVersions.version));

  const grouped = new Map<string, MutableAdminSkill>();
  for (const row of rows) {
    const version = {
      id: row.versionId,
      version: row.version,
      name: row.versionName,
      description: row.description,
      createdSource: row.versionCreatedSource,
      createdAt: row.versionCreatedAt,
    };
    const existing = grouped.get(row.id);
    if (existing) {
      existing.versions.push(version);
      continue;
    }
    if (row.versionId !== row.currentVersionId) {
      throw skillPersistenceFailure();
    }
    grouped.set(row.id, {
      id: row.id,
      name: row.name,
      createdSource: row.createdSource,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      enabled: enabledVersions.has(row.currentVersionId),
      currentVersion: { ...version, markdown: row.markdown },
      versions: [version],
    });
  }
  return [...grouped.values()];
}

async function findCurrentSkillForUpdate(
  transaction: CapabilityTransaction,
  tenantId: string,
  skillId: string,
) {
  const [current] = await transaction
    .select({
      name: skillVersions.name,
      description: skillVersions.description,
      markdown: skillVersions.markdown,
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
    .where(and(eq(skills.tenantId, tenantId), eq(skills.id, skillId)))
    .limit(1)
    .for("update");
  return current;
}

async function assertSkillNameAvailable(
  transaction: CapabilityTransaction,
  tenantId: string,
  name: string,
  excludedSkillId?: string,
): Promise<void> {
  const conditions = [eq(skills.tenantId, tenantId), eq(skills.name, name)];
  if (excludedSkillId) conditions.push(ne(skills.id, excludedSkillId));
  const [existing] = await transaction
    .select({ id: skills.id })
    .from(skills)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    throw new ApplicationError({
      code: "SKILL_NAME_CONFLICT",
      message: "Skill 名称已存在。",
      status: 409,
      expose: true,
    });
  }
}

function skillNotFound(): ApplicationError {
  return new ApplicationError({
    code: "SKILL_NOT_FOUND",
    message: "Skill 不存在。",
    status: 404,
    expose: true,
  });
}

function skillPersistenceFailure(): ApplicationError {
  return new ApplicationError({
    code: "SKILL_PERSISTENCE_FAILURE",
    message: "Skill 配置暂时不可用。",
  });
}
