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

export type ConversationTestPhase = "P3" | "P4";

export type ConversationTestContext = P2TestContext & {
  readonly administrator: AdminPrincipal;
};

const generatedDataDirectories = new Map<
  ConversationTestPhase,
  Set<string>
>();

export function configureConversationTestDatabase(
  phase: ConversationTestPhase,
  environment: Record<string, string | undefined> = process.env,
): string {
  const databaseUrl = configureDedicatedTestDatabase(phase, environment);
  const dataDirectory =
    `/tmp/baigong-agent-${phase.toLowerCase()}-tests-${randomUUID()}`;
  environment.BAIGONG_DATA_DIR = dataDirectory;
  if (environment === process.env) {
    const directories = generatedDataDirectories.get(phase) ?? new Set();
    directories.add(dataDirectory);
    generatedDataDirectories.set(phase, directories);
  }
  return databaseUrl;
}

export async function cleanupConversationTestDataDirectories(
  phase: ConversationTestPhase,
): Promise<void> {
  const directories = generatedDataDirectories.get(phase) ?? new Set();
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  generatedDataDirectories.delete(phase);
}

export async function migrateConversationTestDatabase(): Promise<void> {
  await migrate(getDatabase(), { migrationsFolder: "drizzle" });
}

export async function createConversationTestContext(
  phase: ConversationTestPhase,
  label: string,
): Promise<ConversationTestContext> {
  const context = await createP2TestContext(
    `${phase.toLowerCase()}-${label}`,
  );
  return {
    ...context,
    administrator: {
      userId: context.administratorId,
      tenantId: context.tenantId,
      role: "ADMIN",
      source: "LOCAL",
      sessionId: `${phase.toLowerCase()}-test-${randomUUID()}`,
      integrationId: null,
      displayName: `${phase} Test Administrator`,
      mustChangePassword: false,
    },
  };
}

export async function cleanupConversationTestContext(
  context: ConversationTestContext,
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
