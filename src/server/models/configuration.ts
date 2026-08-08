import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import {
  assertAdminPrincipal,
  type AdminPrincipal,
} from "@/src/server/auth/principal";
import { getDatabase, type Database } from "@/src/server/db/client";
import {
  conversationTurns,
  modelConfigurations,
  modelConfigVersions,
} from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import type { ModelConfigurationRequest } from "@/src/server/http/p3-model-schemas";
import { encryptModelApiKey } from "./credentials";
import type {
  PublicModelConfiguration,
  ResolvedModelConfiguration,
} from "./types";
import {
  decryptStoredModelApiKey,
  resolveModelConfigurationVersion,
} from "./version-resolution";
import { normalizeModelBaseUrl } from "./validation";

const ACTIVE_TURN_STATUSES = ["SUBMITTING", "RUNNING", "CANCELLING"] as const;

type ModelTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type { PublicModelConfiguration, ResolvedModelConfiguration } from "./types";
export { resolveModelConfigurationVersion } from "./version-resolution";

export async function getCurrentModelConfiguration(
  actor: AdminPrincipal,
): Promise<PublicModelConfiguration | null> {
  assertAdminPrincipal(actor);
  const current = await findCurrentVersion(getDatabase(), actor.tenantId);
  return current ? toPublicConfiguration(current) : null;
}

export async function hasCurrentModelConfiguration(
  tenantId: string,
): Promise<boolean> {
  return (await getCurrentModelClientSettings(tenantId)).available;
}

export type ModelClientSettings = {
  readonly available: boolean;
  readonly contextWindowTokens: number | null;
  readonly supportsImageInput: boolean;
  readonly supportsNativePdfInput: boolean;
};

export async function getCurrentModelClientSettings(
  tenantId: string,
): Promise<ModelClientSettings> {
  const [current] = await getDatabase()
    .select({
      contextWindowTokens: modelConfigVersions.contextWindowTokens,
      supportsImageInput: modelConfigVersions.supportsImageInput,
      supportsNativePdfInput: modelConfigVersions.supportsNativePdfInput,
    })
    .from(modelConfigurations)
    .innerJoin(
      modelConfigVersions,
      and(
        eq(modelConfigVersions.id, modelConfigurations.currentVersionId),
        eq(modelConfigVersions.tenantId, modelConfigurations.tenantId),
      ),
    )
    .where(eq(modelConfigurations.tenantId, tenantId))
    .limit(1);
  return current
    ? { available: true, ...current }
    : {
        available: false,
        contextWindowTokens: null,
        supportsImageInput: false,
        supportsNativePdfInput: false,
      };
}

export async function saveModelConfiguration(
  actor: AdminPrincipal,
  input: ModelConfigurationRequest,
): Promise<PublicModelConfiguration> {
  assertAdminPrincipal(actor);
  const normalizedInput = normalizeInput(input);
  const database = getDatabase();

  return database.transaction(async (transaction) => {
    await lockModelConfiguration(transaction, actor.tenantId);
    const current = await findCurrentVersion(transaction, actor.tenantId);
    const [latest] = await transaction
      .select({ version: modelConfigVersions.version })
      .from(modelConfigVersions)
      .where(eq(modelConfigVersions.tenantId, actor.tenantId))
      .orderBy(desc(modelConfigVersions.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;
    const id = randomUUID();
    const apiKey = await resolveNextApiKey(input.apiKey, current);
    const encryptedApiKey = apiKey
      ? await encryptModelApiKey(apiKey, {
          tenantId: actor.tenantId,
          versionId: id,
          version,
        })
      : null;
    const now = new Date();
    const [created] = await transaction
      .insert(modelConfigVersions)
      .values({
        id,
        tenantId: actor.tenantId,
        version,
        providerDisplayName: normalizedInput.providerDisplayName,
        baseUrl: normalizedInput.baseUrl,
        modelName: normalizedInput.modelName,
        contextWindowTokens: normalizedInput.contextWindowTokens,
        supportsImageInput: normalizedInput.supportsImageInput,
        supportsNativePdfInput: normalizedInput.supportsNativePdfInput,
        encryptedApiKey,
        createdByUserId: actor.userId,
        createdAt: now,
      })
      .returning();
    if (!created) throw modelConfigurationFailure();

    await transaction
      .insert(modelConfigurations)
      .values({
        tenantId: actor.tenantId,
        currentVersionId: created.id,
        updatedByUserId: actor.userId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: modelConfigurations.tenantId,
        set: {
          currentVersionId: created.id,
          updatedByUserId: actor.userId,
          updatedAt: now,
        },
      });

    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: current
        ? "MODEL_CONFIGURATION_REPLACED"
        : "MODEL_CONFIGURATION_CREATED",
      targetType: "MODEL_CONFIGURATION",
      targetId: created.id,
      outcome: "SUCCESS",
      metadata: { version: created.version, hasApiKey: apiKey !== null },
    });
    if (current?.encryptedApiKey && input.apiKey !== undefined && !input.apiKey) {
      await writeSecurityAudit(transaction, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        actorSource: "LOCAL",
        action: "MODEL_CREDENTIAL_CLEARED",
        targetType: "MODEL_CONFIGURATION",
        targetId: created.id,
        outcome: "SUCCESS",
        metadata: { version: created.version },
      });
    }
    await purgeUnusedCredentials(transaction, actor.tenantId, created.id, now);

    return {
      ...toPublicConfiguration(created),
      updatedAt: now,
    };
  });
}

export async function deleteModelConfiguration(
  actor: AdminPrincipal,
): Promise<boolean> {
  assertAdminPrincipal(actor);
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    await lockModelConfiguration(transaction, actor.tenantId);
    const current = await findCurrentVersion(transaction, actor.tenantId);
    if (!current) return false;

    await transaction
      .delete(modelConfigurations)
      .where(eq(modelConfigurations.tenantId, actor.tenantId));
    const now = new Date();
    await purgeUnusedCredentials(transaction, actor.tenantId, null, now);
    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: "MODEL_CONFIGURATION_DELETED",
      targetType: "MODEL_CONFIGURATION",
      targetId: current.id,
      outcome: "SUCCESS",
      metadata: { version: current.version },
    });
    return true;
  });
}

export async function purgeUnusedModelCredentials(
  tenantId: string,
): Promise<number> {
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    await lockModelConfiguration(transaction, tenantId);
    const current = await findCurrentVersion(transaction, tenantId);
    const now = new Date();
    const purgedCount = await purgeUnusedCredentials(
      transaction,
      tenantId,
      current?.id ?? null,
      now,
    );
    if (purgedCount > 0) {
      await writeSecurityAudit(transaction, {
        tenantId,
        actorSource: "SYSTEM",
        action: "MODEL_CREDENTIALS_PURGED",
        targetType: "MODEL_CONFIGURATION",
        outcome: "SUCCESS",
        metadata: { purgedCount },
      });
    }
    return purgedCount;
  });
}

export async function lockCurrentModelConfigurationVersion(
  transaction: ModelTransaction,
  tenantId: string,
): Promise<{
  readonly id: string;
  readonly version: number;
  readonly supportsImageInput: boolean;
  readonly supportsNativePdfInput: boolean;
}> {
  await lockModelConfiguration(transaction, tenantId);
  const current = await findCurrentVersion(transaction, tenantId);
  if (!current) throw modelNotConfigured();
  return {
    id: current.id,
    version: current.version,
    supportsImageInput: current.supportsImageInput,
    supportsNativePdfInput: current.supportsNativePdfInput,
  };
}

export async function resolveApiKeyForTest(
  tenantId: string,
  inputApiKey: string | null | undefined,
): Promise<string | null> {
  if (inputApiKey !== undefined) return inputApiKey || null;
  const current = await findCurrentVersion(getDatabase(), tenantId);
  return current ? decryptStoredModelApiKey(current) : null;
}

async function findCurrentVersion(
  database: Pick<Database, "select"> | ModelTransaction,
  tenantId: string,
) {
  const [current] = await database
    .select({
      id: modelConfigVersions.id,
      tenantId: modelConfigVersions.tenantId,
      version: modelConfigVersions.version,
      providerDisplayName: modelConfigVersions.providerDisplayName,
      baseUrl: modelConfigVersions.baseUrl,
      modelName: modelConfigVersions.modelName,
      contextWindowTokens: modelConfigVersions.contextWindowTokens,
      supportsImageInput: modelConfigVersions.supportsImageInput,
      supportsNativePdfInput: modelConfigVersions.supportsNativePdfInput,
      encryptedApiKey: modelConfigVersions.encryptedApiKey,
      credentialPurgedAt: modelConfigVersions.credentialPurgedAt,
      createdAt: modelConfigVersions.createdAt,
      updatedAt: modelConfigurations.updatedAt,
    })
    .from(modelConfigurations)
    .innerJoin(
      modelConfigVersions,
      and(
        eq(modelConfigVersions.id, modelConfigurations.currentVersionId),
        eq(modelConfigVersions.tenantId, modelConfigurations.tenantId),
      ),
    )
    .where(eq(modelConfigurations.tenantId, tenantId))
    .limit(1);
  return current;
}

async function lockModelConfiguration(
  transaction: ModelTransaction,
  tenantId: string,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`model-config:${tenantId}`}))`,
  );
}

async function resolveNextApiKey(
  inputApiKey: string | null | undefined,
  current: Awaited<ReturnType<typeof findCurrentVersion>>,
): Promise<string | null> {
  if (inputApiKey !== undefined) return inputApiKey || null;
  return current ? decryptStoredModelApiKey(current) : null;
}

async function purgeUnusedCredentials(
  transaction: ModelTransaction,
  tenantId: string,
  currentVersionId: string | null,
  now: Date,
): Promise<number> {
  const conditions = [
    eq(modelConfigVersions.tenantId, tenantId),
    isNotNull(modelConfigVersions.encryptedApiKey),
  ];
  if (currentVersionId) {
    conditions.push(ne(modelConfigVersions.id, currentVersionId));
  }

  const candidates = await transaction
    .select({ id: modelConfigVersions.id })
    .from(modelConfigVersions)
    .where(and(...conditions));
  if (candidates.length === 0) return 0;

  const candidateIds = candidates.map(({ id }) => id);
  const activeReferences = await transaction
    .select({ id: conversationTurns.modelConfigVersionId })
    .from(conversationTurns)
    .where(
      and(
        inArray(conversationTurns.modelConfigVersionId, candidateIds),
        inArray(conversationTurns.status, ACTIVE_TURN_STATUSES),
      ),
    );
  const activeIds = new Set(activeReferences.map(({ id }) => id));
  const purgeIds = candidateIds.filter((id) => !activeIds.has(id));
  if (purgeIds.length === 0) return 0;

  await transaction
    .update(modelConfigVersions)
    .set({ encryptedApiKey: null, credentialPurgedAt: now })
    .where(inArray(modelConfigVersions.id, purgeIds));
  return purgeIds.length;
}

function normalizeInput(
  input: ModelConfigurationRequest,
): ModelConfigurationRequest {
  return {
    providerDisplayName: input.providerDisplayName.trim(),
    baseUrl: normalizeModelBaseUrl(input.baseUrl),
    modelName: input.modelName.trim(),
    contextWindowTokens: input.contextWindowTokens,
    supportsImageInput: input.supportsImageInput,
    supportsNativePdfInput: input.supportsNativePdfInput,
    apiKey: input.apiKey,
  };
}

function toPublicConfiguration(version: {
  readonly id: string;
  readonly version: number;
  readonly providerDisplayName: string;
  readonly baseUrl: string;
  readonly modelName: string;
  readonly contextWindowTokens: number | null;
  readonly supportsImageInput: boolean;
  readonly supportsNativePdfInput: boolean;
  readonly encryptedApiKey: string | null;
  readonly createdAt: Date;
  readonly updatedAt?: Date;
}): PublicModelConfiguration {
  return {
    status: "CONFIGURED",
    id: version.id,
    version: version.version,
    providerDisplayName: version.providerDisplayName,
    baseUrl: version.baseUrl,
    modelName: version.modelName,
    contextWindowTokens: version.contextWindowTokens,
    supportsImageInput: version.supportsImageInput,
    supportsNativePdfInput: version.supportsNativePdfInput,
    hasApiKey: version.encryptedApiKey !== null,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt ?? version.createdAt,
  };
}

function modelNotConfigured(): ApplicationError {
  return new ApplicationError({
    code: "MODEL_NOT_CONFIGURED",
    message: "尚未配置可用模型。",
    status: 409,
    expose: true,
  });
}

function modelConfigurationFailure(): ApplicationError {
  return new ApplicationError({
    code: "MODEL_CONFIGURATION_FAILED",
    message: "模型配置保存失败。",
  });
}
