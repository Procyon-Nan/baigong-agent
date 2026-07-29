import "server-only";

import { constants } from "node:fs";
import { access, chmod, mkdir, open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  readDataDirectory,
  type EnvironmentSource,
} from "@/src/server/config/environment";
import { ApplicationError } from "@/src/server/errors";

const SECRET_FILE_PATTERN = /^[a-z0-9][a-z0-9._-]+$/;

export const projectSecrets = {
  credentialEncryption: {
    fileName: "credential-encryption.key",
    length: 32,
  },
  jwtSigning: {
    fileName: "jwt-signing.key",
    length: 32,
  },
} as const;

export async function ensureDataDirectory(
  source: EnvironmentSource = process.env,
  projectRoot: string = process.cwd(),
): Promise<string> {
  const directory = readDataDirectory(source, projectRoot);

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await stat(directory);

  if (!directoryStat.isDirectory()) {
    throw new ApplicationError({
      code: "DATA_DIRECTORY_NOT_DIRECTORY",
      message: "项目数据目录不可用。",
      status: 503,
      expose: true,
    });
  }

  await access(directory, constants.R_OK | constants.W_OK);
  return directory;
}

export async function loadOrCreateProjectSecret(
  fileName: string,
  length = 32,
  source: EnvironmentSource = process.env,
  projectRoot: string = process.cwd(),
): Promise<Buffer> {
  if (!SECRET_FILE_PATTERN.test(fileName) || length < 32) {
    throw new ApplicationError({
      code: "INVALID_SECRET_DEFINITION",
      message: "项目密钥定义无效。",
    });
  }

  const directory = await ensureDataDirectory(source, projectRoot);
  const secretPath = join(directory, fileName);

  try {
    const handle = await open(secretPath, "wx", 0o600);
    try {
      await handle.writeFile(randomBytes(length));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) {
      throw error;
    }
  }

  await chmod(secretPath, 0o600);
  const secret = await readFile(secretPath);

  if (secret.length !== length) {
    throw new ApplicationError({
      code: "INVALID_SECRET_FILE",
      message: "项目密钥文件无效。",
      status: 503,
      expose: true,
    });
  }

  return secret;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
