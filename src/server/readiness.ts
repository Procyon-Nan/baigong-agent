import "server-only";

import { verifyProjectData } from "@/src/server/config/project-data-status";
import { pingDatabase } from "@/src/server/db/client";
import { operationalErrorMetadata } from "@/src/server/errors";

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
    await verifyProjectData();
    return "ready";
  } catch (error) {
    logReadinessFailure("project-data", error);
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
  } catch (error) {
    logReadinessFailure("database", error);
    return "unavailable";
  }
}

function logReadinessFailure(component: "project-data" | "database", error: unknown): void {
  console.error(
    JSON.stringify({
      level: "error",
      event: "readiness_check_failed",
      component,
      ...operationalErrorMetadata(error),
    }),
  );
}
