import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { ensureDataDirectory } from "@/src/server/config/data-directory";
import type { EnvironmentSource } from "@/src/server/config/environment";
import { ApplicationError } from "@/src/server/errors";

const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type PendingAttachmentFile = {
  readonly storageKey: string;
  readonly temporaryPath: string;
  readonly finalPath: string;
};

type StorageOptions = {
  readonly source?: EnvironmentSource;
  readonly projectRoot?: string;
};

export async function stageAttachmentFile(
  bytes: Uint8Array,
  options: StorageOptions = {},
): Promise<PendingAttachmentFile> {
  const directories = await ensureAttachmentDirectories(options);
  const storageKey = randomUUID();
  const temporaryPath = join(directories.temporary, `${storageKey}.upload`);
  const finalPath = attachmentPath(directories.attachments, storageKey);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw storageFailure(error);
  }
  await handle.close();
  return { storageKey, temporaryPath, finalPath };
}

export async function finalizeAttachmentFile(
  file: PendingAttachmentFile,
): Promise<void> {
  try {
    await rename(file.temporaryPath, file.finalPath);
    await chmod(file.finalPath, 0o600);
  } catch (error) {
    throw storageFailure(error);
  }
}

export async function discardStagedAttachmentFile(
  file: PendingAttachmentFile,
): Promise<void> {
  await Promise.all([
    rm(file.temporaryPath, { force: true }),
    rm(file.finalPath, { force: true }),
  ]).catch(() => undefined);
}

export async function readAttachmentFile(
  storageKey: string,
  options: StorageOptions & { readonly signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const directories = await ensureAttachmentDirectories(options);
  try {
    return await readFile(attachmentPath(directories.attachments, storageKey), {
      signal: options.signal,
    });
  } catch (error) {
    throw storageFailure(error);
  }
}

export async function moveAttachmentToTrash(
  storageKey: string,
  options: StorageOptions = {},
): Promise<{ readonly sourcePath: string; readonly trashPath: string }> {
  const directories = await ensureAttachmentDirectories(options);
  const sourcePath = attachmentPath(directories.attachments, storageKey);
  const trashPath = join(directories.trash, `${storageKey}.${randomUUID()}`);
  try {
    await rename(sourcePath, trashPath);
    return { sourcePath, trashPath };
  } catch (error) {
    throw storageFailure(error);
  }
}

export async function restoreTrashedAttachment(input: {
  readonly sourcePath: string;
  readonly trashPath: string;
}): Promise<void> {
  await rename(input.trashPath, input.sourcePath).catch(() => undefined);
}

export async function removeTrashedAttachment(trashPath: string): Promise<void> {
  await rm(trashPath, { force: true }).catch(() => undefined);
}

export async function reconcileAttachmentWorkingFiles(
  cutoff: Date,
  storageKeyExists: (storageKey: string) => Promise<boolean>,
  options: StorageOptions = {},
): Promise<{
  readonly removedTemporary: number;
  readonly reconciledTrash: number;
}> {
  const directories = await ensureAttachmentDirectories(options);
  let removedTemporary = 0;
  for (const entry of await readdir(directories.temporary, {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".upload")) continue;
    const storageKey = entry.name.slice(0, -".upload".length);
    if (!STORAGE_KEY_PATTERN.test(storageKey)) continue;
    const path = join(directories.temporary, entry.name);
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat || fileStat.mtime >= cutoff) continue;
    await rm(path, { force: true }).catch(() => undefined);
    removedTemporary += 1;
  }

  let reconciledTrash = 0;
  for (const entry of await readdir(directories.trash, {
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const storageKey = entry.name.slice(0, 36);
    if (
      !STORAGE_KEY_PATTERN.test(storageKey) ||
      entry.name.at(36) !== "."
    ) {
      continue;
    }
    const trashPath = join(directories.trash, entry.name);
    const finalPath = attachmentPath(directories.attachments, storageKey);
    if (await storageKeyExists(storageKey)) {
      const finalExists = await access(finalPath)
        .then(() => true)
        .catch(() => false);
      if (finalExists) await rm(trashPath, { force: true });
      else await rename(trashPath, finalPath);
    } else {
      await rm(trashPath, { force: true });
    }
    reconciledTrash += 1;
  }
  return { removedTemporary, reconciledTrash };
}

async function ensureAttachmentDirectories(options: StorageOptions): Promise<{
  readonly attachments: string;
  readonly temporary: string;
  readonly trash: string;
}> {
  const dataDirectory = await ensureDataDirectory(
    options.source,
    options.projectRoot,
  );
  const attachments = join(dataDirectory, "attachments");
  const temporary = join(attachments, ".tmp");
  const trash = join(attachments, ".trash");
  await Promise.all([
    mkdir(attachments, { recursive: true, mode: 0o700 }),
    mkdir(temporary, { recursive: true, mode: 0o700 }),
    mkdir(trash, { recursive: true, mode: 0o700 }),
  ]);
  const attachmentDirectory = await stat(attachments);
  if (!attachmentDirectory.isDirectory()) throw storageFailure();
  return { attachments, temporary, trash };
}

function attachmentPath(directory: string, storageKey: string): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) throw storageFailure();
  return join(directory, storageKey);
}

function storageFailure(cause?: unknown): ApplicationError {
  return new ApplicationError({
    code: "ATTACHMENT_STORAGE_FAILURE",
    message: "附件存储暂时不可用。",
    status: 503,
    expose: true,
    cause,
  });
}
