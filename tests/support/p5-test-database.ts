import { eq } from "drizzle-orm";
import { getDatabase } from "@/src/server/db/client";
import { conversationAttachments } from "@/src/server/db/schema";
import {
  cleanupConversationTestContext,
  cleanupConversationTestDataDirectories,
  configureConversationTestDatabase,
  createConversationTestContext,
  migrateConversationTestDatabase,
  type ConversationTestContext,
} from "./conversation-test-database";

export type P5TestContext = ConversationTestContext;

export function configureP5TestDatabase(
  environment: Record<string, string | undefined> = process.env,
): string {
  return configureConversationTestDatabase("P5", environment);
}

export async function cleanupP5TestDataDirectories(): Promise<void> {
  await cleanupConversationTestDataDirectories("P5");
}

export async function migrateP5TestDatabase(): Promise<void> {
  await migrateConversationTestDatabase();
}

export async function createP5TestContext(
  label: string,
): Promise<P5TestContext> {
  return createConversationTestContext("P5", label);
}

export async function cleanupP5TestContext(
  context: P5TestContext,
): Promise<void> {
  await getDatabase()
    .delete(conversationAttachments)
    .where(eq(conversationAttachments.tenantId, context.tenantId));
  await cleanupConversationTestContext(context);
}
