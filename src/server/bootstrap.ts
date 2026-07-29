import "server-only";

import {
  ensureDataDirectory,
  loadOrCreateProjectSecret,
  projectSecrets,
} from "@/src/server/config/data-directory";
import type { EnvironmentSource } from "@/src/server/config/environment";

let applicationInitialization: Promise<void> | undefined;

export function initializeApplication(): Promise<void> {
  applicationInitialization ??= initializeProjectData();
  return applicationInitialization;
}

export async function initializeProjectData(
  source: EnvironmentSource = process.env,
  projectRoot: string = process.cwd(),
): Promise<void> {
  await ensureDataDirectory(source, projectRoot);
  await Promise.all(
    Object.values(projectSecrets).map((secret) =>
      loadOrCreateProjectSecret(secret.fileName, secret.length, source, projectRoot),
    ),
  );
}
