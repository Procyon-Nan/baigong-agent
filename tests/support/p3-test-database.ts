import {
  cleanupConversationTestContext,
  cleanupConversationTestDataDirectories,
  configureConversationTestDatabase,
  createConversationTestContext,
  migrateConversationTestDatabase,
  type ConversationTestContext,
} from "./conversation-test-database";

export type P3TestContext = ConversationTestContext;

export function configureP3TestDatabase(
  environment: Record<string, string | undefined> = process.env,
): string {
  return configureConversationTestDatabase("P3", environment);
}

export async function cleanupP3TestDataDirectories(): Promise<void> {
  await cleanupConversationTestDataDirectories("P3");
}

export async function migrateP3TestDatabase(): Promise<void> {
  await migrateConversationTestDatabase();
}

export async function createP3TestContext(
  label: string,
): Promise<P3TestContext> {
  return createConversationTestContext("P3", label);
}

export async function cleanupP3TestContext(
  context: P3TestContext,
): Promise<void> {
  await cleanupConversationTestContext(context);
}
