import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { normalizeLoginIdentifier, sha256 } from "@/src/server/auth/identifiers";
import { hashPassword } from "@/src/server/auth/password";
import { getDatabase } from "@/src/server/db/client";
import {
  authAccounts,
  authSessions,
  authUsers,
  embeddedClients,
  embeddedTickets,
  externalIdentities,
  loginIdentifierFailures,
  loginSourceLimits,
  securityAuditEvents,
  tenants,
  userProfiles,
} from "@/src/server/db/schema";
import { configureDedicatedTestDatabase } from "./test-database";

export type P2TestContext = {
  readonly suffix: string;
  readonly tenantId: string;
  readonly administratorId: string;
  readonly administratorUsername: string;
  readonly administratorEmail: string;
  readonly administratorPassword: string;
  readonly loginSources: Set<string>;
  readonly loginIdentifiers: Set<string>;
};

type P2TestEnvironment = {
  [name: string]: string | undefined;
  DATABASE_URL?: string;
  P2_TEST_DATABASE_URL?: string;
  BAIGONG_DATA_DIR?: string;
  BAIGONG_APP_ORIGIN?: string;
};

export function configureP2TestDatabase(
  environment: P2TestEnvironment = process.env,
): string {
  return configureDedicatedTestDatabase("P2", environment);
}

export async function createP2TestContext(
  label: string,
  options: { readonly mustChangePassword?: boolean } = {},
): Promise<P2TestContext> {
  const suffix = `${label}-${randomUUID().slice(0, 12)}`.toLowerCase();
  const tenantId = randomUUID();
  const administratorId = randomUUID();
  const administratorUsername = `admin-${suffix}`;
  const administratorEmail = `admin-${suffix}@example.com`;
  const administratorPassword = `P2 test ${randomUUID()} password`;
  const passwordHash = await hashPassword(administratorPassword);
  const now = new Date();
  const database = getDatabase();

  await database.transaction(async (transaction) => {
    await transaction.insert(tenants).values({
      id: tenantId,
      slug: `p2-${suffix}`,
      displayName: `P2 Test ${suffix}`,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(authUsers).values({
      id: administratorId,
      name: "P2 Test Administrator",
      email: administratorEmail,
      emailVerified: true,
      username: administratorUsername,
      displayUsername: administratorUsername,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(authAccounts).values({
      id: randomUUID(),
      accountId: administratorId,
      providerId: "credential",
      userId: administratorId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(userProfiles).values({
      userId: administratorId,
      tenantId,
      source: "LOCAL",
      role: "ADMIN",
      status: "ACTIVE",
      displayName: "P2 Test Administrator",
      displayEmail: administratorEmail,
      mustChangePassword: options.mustChangePassword ?? false,
      createdAt: now,
      updatedAt: now,
    });
  });

  return {
    suffix,
    tenantId,
    administratorId,
    administratorUsername,
    administratorEmail,
    administratorPassword,
    loginSources: new Set(),
    loginIdentifiers: new Set(),
  };
}

export async function cleanupP2TestContext(
  context: P2TestContext,
): Promise<void> {
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const clientRows = await transaction
      .select({ id: embeddedClients.id })
      .from(embeddedClients)
      .where(eq(embeddedClients.tenantId, context.tenantId));
    const userRows = await transaction
      .select({ id: userProfiles.userId })
      .from(userProfiles)
      .where(eq(userProfiles.tenantId, context.tenantId));
    const clientIds = clientRows.map((row) => row.id);
    const userIds = userRows.map((row) => row.id);

    if (userIds.length > 0) {
      await transaction
        .delete(authSessions)
        .where(inArray(authSessions.userId, userIds));
    }
    if (clientIds.length > 0) {
      await transaction
        .delete(embeddedTickets)
        .where(inArray(embeddedTickets.integrationId, clientIds));
      await transaction
        .delete(externalIdentities)
        .where(inArray(externalIdentities.integrationId, clientIds));
      await transaction
        .delete(embeddedClients)
        .where(inArray(embeddedClients.id, clientIds));
    }
    if (userIds.length > 0) {
      await transaction
        .delete(authUsers)
        .where(inArray(authUsers.id, userIds));
    }
    await transaction
      .delete(securityAuditEvents)
      .where(eq(securityAuditEvents.tenantId, context.tenantId));
    await transaction.delete(tenants).where(eq(tenants.id, context.tenantId));

    const sourceHashes = [...context.loginSources].map(sha256);
    if (sourceHashes.length > 0) {
      await transaction
        .delete(loginSourceLimits)
        .where(inArray(loginSourceLimits.sourceHash, sourceHashes));
    }
    const identifierHashes = [...context.loginIdentifiers].map((identifier) =>
      sha256(normalizeLoginIdentifier(identifier)),
    );
    if (identifierHashes.length > 0) {
      await transaction
        .delete(loginIdentifierFailures)
        .where(
          inArray(loginIdentifierFailures.identifierHash, identifierHashes),
        );
    }
  });
}
