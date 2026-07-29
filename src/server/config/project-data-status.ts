import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { projectSecrets } from "@/src/server/config/data-directory";
import {
  readDataDirectory,
  type EnvironmentSource,
} from "@/src/server/config/environment";
import { ApplicationError } from "@/src/server/errors";

export async function verifyProjectData(
  source: EnvironmentSource = process.env,
  projectRoot: string = process.cwd(),
): Promise<void> {
  const directory = readDataDirectory(source, projectRoot);

  try {
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
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    throw projectDataError("DATA_DIRECTORY_UNAVAILABLE", error);
  }

  await Promise.all(
    Object.values(projectSecrets).map(async (secret) => {
      try {
        const secretStat = await stat(join(directory, secret.fileName));
        if (!secretStat.isFile() || secretStat.size !== secret.length) {
          throw new ApplicationError({
            code: "INVALID_SECRET_FILE",
            message: "项目密钥文件无效。",
            status: 503,
            expose: true,
          });
        }
      } catch (error) {
        if (error instanceof ApplicationError) {
          throw error;
        }
        throw projectDataError("SECRET_FILE_UNAVAILABLE", error);
      }
    }),
  );
}

function projectDataError(code: string, cause: unknown): ApplicationError {
  return new ApplicationError({
    code,
    message: "项目数据不可用。",
    status: 503,
    expose: true,
    cause,
  });
}
