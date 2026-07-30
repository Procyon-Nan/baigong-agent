import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureDataDirectory,
  loadOrCreateProjectSecret,
  projectSecrets,
} from "@/src/server/config/data-directory";
import { verifyProjectData } from "@/src/server/config/project-data-status";
import { initializeProjectData } from "@/src/server/bootstrap";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("project data directory", () => {
  it("creates a persistent directory and stable secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "baigong-agent-"));
    temporaryDirectories.push(root);
    const source = { BAIGONG_DATA_DIR: "state" };

    const directory = await ensureDataDirectory(source, root);
    const first = await loadOrCreateProjectSecret("test.key", 32, source, root);
    const second = await loadOrCreateProjectSecret(
      "test.key",
      32,
      source,
      root,
    );

    expect((await stat(directory)).isDirectory()).toBe(true);
    expect(first).toHaveLength(32);
    expect(second).toEqual(first);
    expect(await readFile(join(directory, "test.key"))).toEqual(first);
  });

  it("rejects an existing secret with the wrong length", async () => {
    const root = await mkdtemp(join(tmpdir(), "baigong-agent-"));
    temporaryDirectories.push(root);
    const source = { BAIGONG_DATA_DIR: "state" };
    const directory = await ensureDataDirectory(source, root);
    await writeFile(join(directory, "invalid.key"), "short");

    await expect(
      loadOrCreateProjectSecret("invalid.key", 32, source, root),
    ).rejects.toMatchObject({
      code: "INVALID_SECRET_FILE",
    });
  });

  it("keeps authentication and encryption keys as separate persistent material", async () => {
    const root = await mkdtemp(join(tmpdir(), "baigong-agent-"));
    temporaryDirectories.push(root);
    const source = { BAIGONG_DATA_DIR: "state" };
    const authSecret = await loadOrCreateProjectSecret(
      projectSecrets.betterAuth.fileName,
      projectSecrets.betterAuth.length,
      source,
      root,
    );
    const credentialSecret = await loadOrCreateProjectSecret(
      projectSecrets.credentialEncryption.fileName,
      projectSecrets.credentialEncryption.length,
      source,
      root,
    );

    expect(authSecret).not.toEqual(credentialSecret);
  });

  it("initializes and verifies project data separately", async () => {
    const root = await mkdtemp(join(tmpdir(), "baigong-agent-"));
    temporaryDirectories.push(root);
    const source = { BAIGONG_DATA_DIR: "state" };

    await expect(verifyProjectData(source, root)).rejects.toMatchObject({
      code: "DATA_DIRECTORY_UNAVAILABLE",
    });
    await expect(stat(join(root, "state"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    await initializeProjectData(source, root);
    await expect(verifyProjectData(source, root)).resolves.toBeUndefined();
  });
});
