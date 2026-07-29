import {
  ensureDataDirectory,
  loadOrCreateProjectSecret,
  projectSecretFiles,
} from "@/src/server/config/data-directory";
import { pingDatabase } from "@/src/server/db/client";

export type ReadinessState = "ready" | "missing" | "unavailable";

export type ApplicationReadiness = {
  readonly application: "ready";
  readonly dataDirectory: ReadinessState;
  readonly database: ReadinessState;
  readonly model: "not-configured";
  readonly checkedAt: string;
};

export async function inspectApplicationReadiness(): Promise<ApplicationReadiness> {
  const [dataDirectory, database] = await Promise.all([
    inspectDataDirectory(),
    inspectDatabase(),
  ]);

  return {
    application: "ready",
    dataDirectory,
    database,
    model: "not-configured",
    checkedAt: new Date().toISOString(),
  };
}

export function isInfrastructureReady(readiness: ApplicationReadiness): boolean {
  return readiness.dataDirectory === "ready" && readiness.database === "ready";
}

async function inspectDataDirectory(): Promise<ReadinessState> {
  try {
    await ensureDataDirectory();
    await Promise.all([
      loadOrCreateProjectSecret(projectSecretFiles.credentialEncryption),
      loadOrCreateProjectSecret(projectSecretFiles.jwtSigning),
    ]);
    return "ready";
  } catch {
    return "unavailable";
  }
}

async function inspectDatabase(): Promise<ReadinessState> {
  if (!process.env.DATABASE_URL) {
    return "missing";
  }

  try {
    await pingDatabase();
    return "ready";
  } catch {
    return "unavailable";
  }
}
