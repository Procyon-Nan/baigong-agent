import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decryptValue,
  encryptValue,
  type EncryptedValueBinding,
} from "@/src/server/security/encrypted-values";

const temporaryDirectories: string[] = [];
const binding: EncryptedValueBinding = {
  tenantId: "tenant-a",
  recordId: "version-a",
  recordVersion: 1,
  purpose: "model-api-key",
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("encrypted values", () => {
  it("round trips with a persistent project encryption key", async () => {
    const location = await createKeyLocation();
    const encrypted = await encryptValue("secret-value", binding, location);

    expect(encrypted).not.toContain("secret-value");
    await expect(decryptValue(encrypted, binding, location)).resolves.toBe(
      "secret-value",
    );
  });

  it("uses an independent nonce for every encrypted value", async () => {
    const location = await createKeyLocation();
    const first = await encryptValue("same-value", binding, location);
    const second = await encryptValue("same-value", binding, location);

    expect(first).not.toBe(second);
  });

  it.each([
    { ...binding, tenantId: "tenant-b" },
    { ...binding, recordId: "version-b" },
    { ...binding, recordVersion: 2 },
    { ...binding, purpose: "conversation-continuation-token" as const },
  ])("rejects an AAD binding mismatch", async (mismatchedBinding) => {
    const location = await createKeyLocation();
    const encrypted = await encryptValue("secret-value", binding, location);

    await expect(
      decryptValue(encrypted, mismatchedBinding, location),
    ).rejects.toMatchObject({ code: "ENCRYPTED_VALUE_INVALID" });
  });

  it("rejects ciphertext encrypted by a different project key", async () => {
    const firstLocation = await createKeyLocation();
    const secondLocation = await createKeyLocation();
    const encrypted = await encryptValue(
      "secret-value",
      binding,
      firstLocation,
    );

    await expect(
      decryptValue(encrypted, binding, secondLocation),
    ).rejects.toMatchObject({ code: "ENCRYPTED_VALUE_INVALID" });
  });
});

async function createKeyLocation(): Promise<{
  readonly source: { readonly BAIGONG_DATA_DIR: string };
  readonly projectRoot: string;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "baigong-encryption-"));
  temporaryDirectories.push(projectRoot);
  return {
    source: { BAIGONG_DATA_DIR: "state" },
    projectRoot,
  };
}
