import {
  decryptValue,
  encryptValue,
} from "@/src/server/security/encrypted-values";

export type ModelCredentialBinding = {
  readonly tenantId: string;
  readonly versionId: string;
  readonly version: number;
};

export async function encryptModelApiKey(
  apiKey: string,
  binding: ModelCredentialBinding,
): Promise<string> {
  return encryptValue(apiKey, {
    tenantId: binding.tenantId,
    recordId: binding.versionId,
    recordVersion: binding.version,
    purpose: "model-api-key",
  });
}

export async function decryptModelApiKey(
  encryptedApiKey: string,
  binding: ModelCredentialBinding,
): Promise<string> {
  return decryptValue(encryptedApiKey, {
    tenantId: binding.tenantId,
    recordId: binding.versionId,
    recordVersion: binding.version,
    purpose: "model-api-key",
  });
}

export async function encryptContinuationToken(
  continuationToken: string,
  binding: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly revision: number;
  },
): Promise<string> {
  return encryptValue(continuationToken, {
    tenantId: binding.tenantId,
    recordId: binding.conversationId,
    recordVersion: binding.revision,
    purpose: "conversation-continuation-token",
  });
}

export async function decryptContinuationToken(
  encryptedContinuationToken: string,
  binding: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly revision: number;
  },
): Promise<string> {
  return decryptValue(encryptedContinuationToken, {
    tenantId: binding.tenantId,
    recordId: binding.conversationId,
    recordVersion: binding.revision,
    purpose: "conversation-continuation-token",
  });
}
