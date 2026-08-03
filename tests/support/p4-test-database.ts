import {
  cleanupConversationTestContext,
  cleanupConversationTestDataDirectories,
  configureConversationTestDatabase,
  createConversationTestContext,
  migrateConversationTestDatabase,
  type ConversationTestContext,
} from "./conversation-test-database";

export type P4TestContext = ConversationTestContext;

export function configureP4TestDatabase(
  environment: Record<string, string | undefined> = process.env,
): string {
  return configureConversationTestDatabase("P4", environment);
}

export async function cleanupP4TestDataDirectories(): Promise<void> {
  await cleanupConversationTestDataDirectories("P4");
}

export async function migrateP4TestDatabase(): Promise<void> {
  await migrateConversationTestDatabase();
}

export async function createP4TestContext(
  label: string,
): Promise<P4TestContext> {
  return createConversationTestContext("P4", label);
}

export async function cleanupP4TestContext(
  context: P4TestContext,
): Promise<void> {
  await cleanupConversationTestContext(context);
}
