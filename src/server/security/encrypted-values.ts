import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  loadOrCreateProjectSecret,
  projectSecrets,
} from "@/src/server/config/data-directory";
import type { EnvironmentSource } from "@/src/server/config/environment";
import { ApplicationError } from "@/src/server/errors";

const ALGORITHM = "aes-256-gcm";
const FORMAT_VERSION = "v1";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type EncryptedValuePurpose =
  | "model-api-key"
  | "conversation-continuation-token";

export type EncryptedValueBinding = {
  readonly tenantId: string;
  readonly recordId: string;
  readonly recordVersion: string | number;
  readonly purpose: EncryptedValuePurpose;
};

type KeyLocation = {
  readonly source?: EnvironmentSource;
  readonly projectRoot?: string;
};

export async function encryptValue(
  plaintext: string,
  binding: EncryptedValueBinding,
  keyLocation: KeyLocation = {},
): Promise<string> {
  assertBinding(binding);
  if (!plaintext) throw invalidEncryptedValue();

  const key = await loadEncryptionKey(keyLocation);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(associatedData(binding));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    authTag.toString("base64url"),
  ].join(".");
}

export async function decryptValue(
  encryptedValue: string,
  binding: EncryptedValueBinding,
  keyLocation: KeyLocation = {},
): Promise<string> {
  assertBinding(binding);
  const [format, nonceValue, ciphertextValue, authTagValue, extra] =
    encryptedValue.split(".");
  if (
    format !== FORMAT_VERSION ||
    !nonceValue ||
    !ciphertextValue ||
    !authTagValue ||
    extra !== undefined
  ) {
    throw invalidEncryptedValue();
  }

  try {
    const nonce = decodeBase64Url(nonceValue, NONCE_BYTES);
    const ciphertext = decodeBase64Url(ciphertextValue);
    const authTag = decodeBase64Url(authTagValue, AUTH_TAG_BYTES);
    const key = await loadEncryptionKey(keyLocation);
    const decipher = createDecipheriv(ALGORITHM, key, nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(associatedData(binding));
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw invalidEncryptedValue(error);
  }
}

function associatedData(binding: EncryptedValueBinding): Buffer {
  return Buffer.from(
    JSON.stringify({
      format: FORMAT_VERSION,
      tenantId: binding.tenantId,
      recordId: binding.recordId,
      recordVersion: String(binding.recordVersion),
      purpose: binding.purpose,
    }),
    "utf8",
  );
}

async function loadEncryptionKey(keyLocation: KeyLocation): Promise<Buffer> {
  return loadOrCreateProjectSecret(
    projectSecrets.credentialEncryption.fileName,
    projectSecrets.credentialEncryption.length,
    keyLocation.source,
    keyLocation.projectRoot,
  );
}

function decodeBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!BASE64URL_PATTERN.test(value)) throw invalidEncryptedValue();
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length === 0 ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes) ||
    decoded.toString("base64url") !== value
  ) {
    throw invalidEncryptedValue();
  }
  return decoded;
}

function assertBinding(binding: EncryptedValueBinding): void {
  if (
    !binding.tenantId ||
    !binding.recordId ||
    String(binding.recordVersion).length === 0
  ) {
    throw invalidEncryptedValue();
  }
}

function invalidEncryptedValue(cause?: unknown): ApplicationError {
  return new ApplicationError({
    code: "ENCRYPTED_VALUE_INVALID",
    message: "加密数据无效或无法解密。",
    status: 503,
    cause,
  });
}
