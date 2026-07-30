import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import { opaqueToken } from "@/src/server/auth/identifiers";
import { normalizeAllowedOrigins } from "@/src/server/auth/origin";
import { hashPassword } from "@/src/server/auth/password";
import {
  assertAdminPrincipal,
  type AdminPrincipal,
} from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import {
  authSessions,
  embeddedClients,
  embeddedSessions,
  embeddedTickets,
} from "@/src/server/db/schema";
import {
  clientNotFound,
  integrationFailure,
  invalidClientOperation,
} from "./errors";
import type {
  IntegrationTransaction,
  ManagedEmbeddedClient,
} from "./types";

export async function listEmbeddedClients(
  principal: AdminPrincipal,
): Promise<ManagedEmbeddedClient[]> {
  assertAdminPrincipal(principal);
  const rows = await getDatabase()
    .select()
    .from(embeddedClients)
    .where(
      and(
        eq(embeddedClients.tenantId, principal.tenantId),
        sql`${embeddedClients.status} <> 'DELETED'`,
      ),
    )
    .orderBy(embeddedClients.createdAt);
  return rows.map(toManagedClient);
}

export async function createEmbeddedClient(
  actor: AdminPrincipal,
  input: { readonly name: string; readonly allowedOrigins: readonly string[] },
): Promise<{
  readonly client: ManagedEmbeddedClient;
  readonly clientSecret: string;
}> {
  assertAdminPrincipal(actor);
  const name = validateClientName(input.name);
  const allowedOrigins = normalizeAllowedOrigins(
    input.allowedOrigins,
    isProduction(),
  );
  const clientSecret = `bgs_${opaqueToken(32)}`;
  const secretHash = await hashPassword(clientSecret);
  const now = new Date();
  const database = getDatabase();
  const client = await database.transaction(async (transaction) => {
    const [created] = await transaction
      .insert(embeddedClients)
      .values({
        tenantId: actor.tenantId,
        name,
        clientId: `bgc_${opaqueToken(18)}`,
        secretHash,
        status: "ACTIVE",
        allowedOrigins,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw integrationFailure();
    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: "EMBEDDED_CLIENT_CREATED",
      targetType: "EMBEDDED_CLIENT",
      targetId: created.id,
      outcome: "SUCCESS",
    });
    return created;
  });
  return { client: toManagedClient(client), clientSecret };
}

export async function updateEmbeddedClient(
  actor: AdminPrincipal,
  clientId: string,
  update: {
    readonly name?: string;
    readonly allowedOrigins?: readonly string[];
    readonly status?: "ACTIVE" | "DISABLED";
  },
): Promise<void> {
  assertAdminPrincipal(actor);
  if (!update.name && !update.allowedOrigins && !update.status) {
    throw invalidClientOperation();
  }
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const [client] = await transaction
      .select()
      .from(embeddedClients)
      .where(
        and(
          eq(embeddedClients.id, clientId),
          eq(embeddedClients.tenantId, actor.tenantId),
        ),
      )
      .limit(1)
      .for("update");
    if (!client || client.status === "DELETED") throw clientNotFound();
    const status = update.status ?? client.status;
    await transaction
      .update(embeddedClients)
      .set({
        name: update.name ? validateClientName(update.name) : client.name,
        allowedOrigins: update.allowedOrigins
          ? normalizeAllowedOrigins(update.allowedOrigins, isProduction())
          : client.allowedOrigins,
        status,
        updatedAt: new Date(),
      })
      .where(eq(embeddedClients.id, client.id));
    if (status === "DISABLED" && client.status !== "DISABLED") {
      await revokeClientAccess(transaction, client.id);
    }
    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: "EMBEDDED_CLIENT_UPDATED",
      targetType: "EMBEDDED_CLIENT",
      targetId: client.id,
      outcome: "SUCCESS",
      metadata: { status },
    });
  });
}

export async function rotateEmbeddedClientSecret(
  actor: AdminPrincipal,
  clientId: string,
): Promise<string> {
  assertAdminPrincipal(actor);
  const clientSecret = `bgs_${opaqueToken(32)}`;
  const secretHash = await hashPassword(clientSecret);
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const [client] = await transaction
      .update(embeddedClients)
      .set({ secretHash, updatedAt: new Date() })
      .where(
        and(
          eq(embeddedClients.id, clientId),
          eq(embeddedClients.tenantId, actor.tenantId),
          sql`${embeddedClients.status} <> 'DELETED'`,
        ),
      )
      .returning({ id: embeddedClients.id });
    if (!client) throw clientNotFound();
    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: "EMBEDDED_CLIENT_SECRET_ROTATED",
      targetType: "EMBEDDED_CLIENT",
      targetId: client.id,
      outcome: "SUCCESS",
    });
  });
  return clientSecret;
}

export async function deleteEmbeddedClient(
  actor: AdminPrincipal,
  clientId: string,
): Promise<void> {
  assertAdminPrincipal(actor);
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const [client] = await transaction
      .update(embeddedClients)
      .set({ status: "DELETED", deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(embeddedClients.id, clientId),
          eq(embeddedClients.tenantId, actor.tenantId),
        ),
      )
      .returning({ id: embeddedClients.id });
    if (!client) throw clientNotFound();
    await revokeClientAccess(transaction, client.id);
    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: "EMBEDDED_CLIENT_DELETED",
      targetType: "EMBEDDED_CLIENT",
      targetId: client.id,
      outcome: "SUCCESS",
    });
  });
}

async function revokeClientAccess(
  transaction: IntegrationTransaction,
  clientId: string,
): Promise<void> {
  const now = new Date();
  await transaction
    .update(embeddedTickets)
    .set({ consumedAt: now })
    .where(
      and(
        eq(embeddedTickets.integrationId, clientId),
        isNull(embeddedTickets.consumedAt),
      ),
    );
  const sessions = await transaction
    .select({ sessionId: embeddedSessions.sessionId })
    .from(embeddedSessions)
    .where(
      and(
        eq(embeddedSessions.integrationId, clientId),
        isNull(embeddedSessions.revokedAt),
      ),
    );
  const sessionIds = sessions.map((session) => session.sessionId);
  if (sessionIds.length === 0) return;
  await transaction
    .update(embeddedSessions)
    .set({ revokedAt: now })
    .where(inArray(embeddedSessions.sessionId, sessionIds));
  await transaction
    .update(authSessions)
    .set({ expiresAt: now, updatedAt: now })
    .where(inArray(authSessions.id, sessionIds));
}

function toManagedClient(
  client: typeof embeddedClients.$inferSelect,
): ManagedEmbeddedClient {
  return {
    id: client.id,
    name: client.name,
    clientId: client.clientId,
    status: client.status === "ACTIVE" ? "ACTIVE" : "DISABLED",
    allowedOrigins: client.allowedOrigins,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

function validateClientName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 120) throw invalidClientOperation();
  return normalized;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
