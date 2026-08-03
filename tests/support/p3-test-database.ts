import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { AdminPrincipal } from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import {
  conversations,
  modelConfigurations,
  modelConfigVersions,
} from "@/src/server/db/schema";
import {
  cleanupP2TestContext,
  createP2TestContext,
  type P2TestContext,
} from "./p2-test-database";
import { configureDedicatedTestDatabase } from "./test-database";

export type P3TestContext = P2TestContext & {
  readonly administrator: AdminPrincipal;
};

const generatedDataDirectories = new Set<string>();

export function configureP3TestDatabase(
  environment: Record<string, string | undefined> = process.env,
): string {
  const databaseUrl = configureDedicatedTestDatabase("P3", environment);
  const dataDirectory = `/tmp/baigong-agent-p3-tests-${randomUUID()}`;
  environment.BAIGONG_DATA_DIR = dataDirectory;
  if (environment === process.env) {
    generatedDataDirectories.add(dataDirectory);
  }
  return databaseUrl;
}

export async function cleanupP3TestDataDirectories(): Promise<void> {
  await Promise.all(
    [...generatedDataDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  generatedDataDirectories.clear();
}

export async function migrateP3TestDatabase(): Promise<void> {
  await migrate(getDatabase(), { migrationsFolder: "drizzle" });
}

export async function createP3TestContext(
  label: string,
): Promise<P3TestContext> {
  const context = await createP2TestContext(`p3-${label}`);
  return {
    ...context,
    administrator: {
      userId: context.administratorId,
      tenantId: context.tenantId,
      role: "ADMIN",
      source: "LOCAL",
      sessionId: `p3-test-${randomUUID()}`,
      integrationId: null,
      displayName: "P3 Test Administrator",
      mustChangePassword: false,
    },
  };
}

export async function cleanupP3TestContext(
  context: P3TestContext,
): Promise<void> {
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    await transaction
      .delete(conversations)
      .where(eq(conversations.tenantId, context.tenantId));
    await transaction
      .delete(modelConfigurations)
      .where(eq(modelConfigurations.tenantId, context.tenantId));
    await transaction
      .delete(modelConfigVersions)
      .where(eq(modelConfigVersions.tenantId, context.tenantId));
  });
  await cleanupP2TestContext(context);
}
