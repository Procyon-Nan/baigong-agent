import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/src/server/db/client";
import { modelConfigVersions } from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import { decryptModelApiKey } from "./credentials";
import type { ResolvedModelConfiguration } from "./types";

export async function resolveModelConfigurationVersion(
  tenantId: string,
  versionId: string,
): Promise<ResolvedModelConfiguration> {
  const [version] = await getDatabase()
    .select()
    .from(modelConfigVersions)
    .where(
      and(
        eq(modelConfigVersions.tenantId, tenantId),
        eq(modelConfigVersions.id, versionId),
      ),
    )
    .limit(1);
  if (!version) throw modelNotConfigured();

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
    updatedAt: version.createdAt,
    tenantId,
    apiKey: await decryptStoredModelApiKey(version),
  };
}

export async function decryptStoredModelApiKey(version: {
  readonly id: string;
  readonly tenantId: string;
  readonly version: number;
  readonly encryptedApiKey: string | null;
  readonly credentialPurgedAt: Date | null;
}): Promise<string | null> {
  if (!version.encryptedApiKey) {
    if (version.credentialPurgedAt) throw modelCredentialUnavailable();
    return null;
  }
  return decryptModelApiKey(version.encryptedApiKey, {
    tenantId: version.tenantId,
    versionId: version.id,
    version: version.version,
  });
}

function modelNotConfigured(): ApplicationError {
  return new ApplicationError({
    code: "MODEL_NOT_CONFIGURED",
    message: "尚未配置可用模型。",
    status: 409,
    expose: true,
  });
}

function modelCredentialUnavailable(): ApplicationError {
  return new ApplicationError({
    code: "MODEL_CREDENTIAL_UNAVAILABLE",
    message: "模型凭据已不可用，请重新配置。",
    status: 409,
    expose: true,
  });
}
