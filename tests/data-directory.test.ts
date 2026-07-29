import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureDataDirectory,
  loadOrCreateProjectSecret,
} from "@/src/server/config/data-directory";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("project data directory", () => {
  it("creates a persistent directory and stable secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "baigong-agent-"));
    temporaryDirectories.push(root);
    const source = { BAIGONG_DATA_DIR: "state" };

    const directory = await ensureDataDirectory(source, root);
    const first = await loadOrCreateProjectSecret("test.key", 32, source, root);
    const second = await loadOrCreateProjectSecret("test.key", 32, source, root);

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

    await expect(loadOrCreateProjectSecret("invalid.key", 32, source, root)).rejects.toMatchObject({
      code: "INVALID_SECRET_FILE",
    });
  });
});
