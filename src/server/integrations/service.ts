import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import { opaqueToken, sha256 } from "@/src/server/auth/identifiers";
import { consumeLoginSourceAttempt } from "@/src/server/auth/login-protection";
import { hashPassword, verifyPassword } from "@/src/server/auth/password";
import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import { normalizeAllowedOrigins } from "@/src/server/auth/origin";
import { getDatabase } from "@/src/server/db/client";
import {
  authSessions,
  authUsers,
  embeddedClients,
  embeddedSessions,
  embeddedTickets,
  externalIdentities,
  userProfiles,
} from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import { ensureDefaultTenant } from "@/src/server/users/default-tenant";

const TICKET_LIFETIME_MS = 120_000;
const EMBEDDED_SESSION_LIFETIME_MS = 60 * 60_000;

export type ManagedEmbeddedClient = {
  readonly id: string;
  readonly name: string;
  readonly clientId: string;
  readonly status: "ACTIVE" | "DISABLED";
  readonly allowedOrigins: string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export async function listEmbeddedClients(
  tenantId: string,
): Promise<ManagedEmbeddedClient[]> {
  const rows = await getDatabase()
    .select()
    .from(embeddedClients)
    .where(
      and(
        eq(embeddedClients.tenantId, tenantId),
        sql`${embeddedClients.status} <> 'DELETED'`,
      ),
    )
    .orderBy(embeddedClients.createdAt);
  return rows.map(toManagedClient);
}

export async function createEmbeddedClient(
  actor: AuthenticatedPrincipal,
  input: { readonly name: string; readonly allowedOrigins: readonly string[] },
): Promise<{
  readonly client: ManagedEmbeddedClient;
  readonly clientSecret: string;
}> {
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
  actor: AuthenticatedPrincipal,
  clientId: string,
  update: {
    readonly name?: string;
    readonly allowedOrigins?: readonly string[];
    readonly status?: "ACTIVE" | "DISABLED";
  },
): Promise<void> {
  if (!update.name && !update.allowedOrigins && !update.status)
    throw invalidClientOperation();
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
  actor: AuthenticatedPrincipal,
  clientId: string,
): Promise<string> {
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
  actor: AuthenticatedPrincipal,
  clientId: string,
): Promise<void> {
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

export async function issueEmbeddedTicket(input: {
  readonly requestSource: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly externalUserId: string;
  readonly origin: string;
  readonly agentId?: string;
  readonly displayName?: string;
  readonly displayEmail?: string;
}): Promise<{ readonly ticket: string; readonly expiresAt: Date }> {
  try {
    await consumeLoginSourceAttempt(`embedded-client:${input.requestSource}`);
  } catch (error) {
    await writeSecurityAudit(getDatabase(), {
      tenantId: await ensureDefaultTenant(),
      actorSource: "INTEGRATION",
      action: "EMBEDDED_CLIENT_RATE_LIMITED",
      targetType: "EMBEDDED_CLIENT",
      outcome: "DENIED",
    });
    throw error;
  }
  const externalUserId = input.externalUserId.trim();
  if (!externalUserId || externalUserId.length > 255)
    throw invalidTicketRequest();
  const database = getDatabase();
  const [client] = await database
    .select()
    .from(embeddedClients)
    .where(eq(embeddedClients.clientId, input.clientId))
    .limit(1);
  const secretValid = client
    ? await verifyPassword(client.secretHash, input.clientSecret)
    : (await hashPassword("invalid embedded client secret"), false);
  if (
    !client ||
    client.status !== "ACTIVE" ||
    !secretValid ||
    !client.allowedOrigins.includes(input.origin)
  ) {
    await writeSecurityAudit(database, {
      tenantId: client?.tenantId ?? (await ensureDefaultTenant()),
      actorSource: "INTEGRATION",
      action: "EMBEDDED_CLIENT_AUTH_FAILED",
      targetType: "EMBEDDED_CLIENT",
      targetId: client?.id,
      outcome: "DENIED",
    });
    throw invalidClientCredentials();
  }
  const displayName = input.displayName?.trim();
  const displayEmail = input.displayEmail?.trim().toLowerCase();
  if (
    (displayName && displayName.length > 120) ||
    (displayEmail && displayEmail.length > 254)
  ) {
    throw invalidTicketRequest();
  }

  const ticket = `bgt_${opaqueToken(32)}`;
  const expiresAt = new Date(Date.now() + TICKET_LIFETIME_MS);
  await database.transaction(async (transaction) => {
    await transaction.insert(embeddedTickets).values({
      ticketDigest: sha256(ticket),
      integrationId: client.id,
      externalUserId,
      origin: input.origin,
      agentId: input.agentId?.trim() || "main",
      jti: randomUUID(),
      displayName: displayName || null,
      displayEmail: displayEmail || null,
      expiresAt,
    });
    await writeSecurityAudit(transaction, {
      tenantId: client.tenantId,
      actorSource: "INTEGRATION",
      action: "EMBEDDED_TICKET_ISSUED",
      targetType: "EMBEDDED_CLIENT",
      targetId: client.id,
      outcome: "SUCCESS",
    });
  });
  return { ticket, expiresAt };
}

export async function exchangeEmbeddedTicket(input: {
  readonly ticket: string;
  readonly origin: string;
  readonly previousPrincipal: AuthenticatedPrincipal | null;
}): Promise<{
  readonly token: string;
  readonly expiresAt: Date;
  readonly principal: AuthenticatedPrincipal;
}> {
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    const now = new Date();
    const [ticket] = await transaction
      .select({ ticket: embeddedTickets, client: embeddedClients })
      .from(embeddedTickets)
      .innerJoin(
        embeddedClients,
        eq(embeddedClients.id, embeddedTickets.integrationId),
      )
      .where(
        and(
          eq(embeddedTickets.ticketDigest, sha256(input.ticket)),
          eq(embeddedTickets.origin, input.origin),
          isNull(embeddedTickets.consumedAt),
          gt(embeddedTickets.expiresAt, now),
          eq(embeddedClients.status, "ACTIVE"),
        ),
      )
      .limit(1)
      .for("update");
    if (!ticket) throw invalidTicket();
    await transaction
      .update(embeddedTickets)
      .set({ consumedAt: now })
      .where(
        and(
          eq(embeddedTickets.id, ticket.ticket.id),
          isNull(embeddedTickets.consumedAt),
        ),
      );

    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${ticket.client.id}:${ticket.ticket.externalUserId}`}))`,
    );
    const userId = await findOrCreateEmbeddedUser(
      transaction,
      ticket.client,
      ticket.ticket,
      now,
    );
    if (input.previousPrincipal) {
      if (
        input.previousPrincipal.source !== "EMBEDDED" ||
        input.previousPrincipal.integrationId !== ticket.client.id ||
        input.previousPrincipal.userId !== userId
      ) {
        throw invalidTicket();
      }
      await revokeEmbeddedSession(
        transaction,
        input.previousPrincipal.sessionId,
        now,
      );
    }

    const sessionId = randomUUID();
    const token = opaqueToken(32);
    const expiresAt = new Date(now.getTime() + EMBEDDED_SESSION_LIFETIME_MS);
    await transaction.insert(authSessions).values({
      id: sessionId,
      token,
      userId,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(embeddedSessions).values({
      sessionId,
      integrationId: ticket.client.id,
      userId,
      agentId: ticket.ticket.agentId,
      expiresAt,
      createdAt: now,
    });
    await writeSecurityAudit(transaction, {
      tenantId: ticket.client.tenantId,
      actorUserId: userId,
      actorSource: "EMBEDDED",
      action: input.previousPrincipal
        ? "EMBEDDED_SESSION_RENEWED"
        : "EMBEDDED_SESSION_CREATED",
      targetType: "SESSION",
      targetId: sessionId,
      outcome: "SUCCESS",
      metadata: {
        integrationId: ticket.client.id,
        agentId: ticket.ticket.agentId,
      },
    });
    const [profile] = await transaction
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    if (!profile) throw integrationFailure();
    return {
      token,
      expiresAt,
      principal: {
        userId,
        tenantId: profile.tenantId,
        role: "USER",
        source: "EMBEDDED",
        sessionId,
        integrationId: ticket.client.id,
        displayName: profile.displayName,
        mustChangePassword: false,
      },
    };
  });
}

export async function revokeCurrentEmbeddedSession(
  principal: AuthenticatedPrincipal,
): Promise<void> {
  if (principal.source !== "EMBEDDED") throw invalidClientOperation();
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    await revokeEmbeddedSession(transaction, principal.sessionId, new Date());
    await writeSecurityAudit(transaction, {
      tenantId: principal.tenantId,
      actorUserId: principal.userId,
      actorSource: "EMBEDDED",
      action: "EMBEDDED_SESSION_REVOKED",
      targetType: "SESSION",
      targetId: principal.sessionId,
      outcome: "SUCCESS",
    });
  });
}

type IntegrationTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

async function findOrCreateEmbeddedUser(
  transaction: IntegrationTransaction,
  client: typeof embeddedClients.$inferSelect,
  ticket: typeof embeddedTickets.$inferSelect,
  now: Date,
): Promise<string> {
  const [identity] = await transaction
    .select({ userId: externalIdentities.userId })
    .from(externalIdentities)
    .where(
      and(
        eq(externalIdentities.integrationId, client.id),
        eq(externalIdentities.externalUserId, ticket.externalUserId),
      ),
    )
    .limit(1);
  if (identity) {
    const [profile] = await transaction
      .select({ status: userProfiles.status })
      .from(userProfiles)
      .where(eq(userProfiles.userId, identity.userId))
      .limit(1)
      .for("update");
    if (!profile || profile.status !== "ACTIVE") throw invalidTicket();
    await transaction
      .update(userProfiles)
      .set({
        displayName: ticket.displayName || undefined,
        displayEmail: ticket.displayEmail,
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(userProfiles.userId, identity.userId));
    return identity.userId;
  }

  const userId = randomUUID();
  const displayName =
    ticket.displayName || `嵌入用户 ${ticket.externalUserId.slice(0, 24)}`;
  await transaction.insert(authUsers).values({
    id: userId,
    name: displayName,
    email: `embedded.${userId}@invalid.baigong.local`,
    emailVerified: false,
    username: null,
    displayUsername: null,
    createdAt: now,
    updatedAt: now,
  });
  await transaction.insert(userProfiles).values({
    userId,
    tenantId: client.tenantId,
    source: "EMBEDDED",
    role: "USER",
    status: "ACTIVE",
    displayName,
    displayEmail: ticket.displayEmail,
    mustChangePassword: false,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await transaction.insert(externalIdentities).values({
    integrationId: client.id,
    externalUserId: ticket.externalUserId,
    userId,
    createdAt: now,
    updatedAt: now,
  });
  return userId;
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

async function revokeEmbeddedSession(
  transaction: IntegrationTransaction,
  sessionId: string,
  now: Date,
): Promise<void> {
  await transaction
    .update(embeddedSessions)
    .set({ revokedAt: now })
    .where(eq(embeddedSessions.sessionId, sessionId));
  await transaction
    .update(authSessions)
    .set({ expiresAt: now, updatedAt: now })
    .where(eq(authSessions.id, sessionId));
}

function toManagedClient(
  client: typeof embeddedClients.$inferSelect,
): ManagedEmbeddedClient {
  return {
    id: client.id,
    name: client.name,
    clientId: client.clientId,
    status: client.status as ManagedEmbeddedClient["status"],
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

function clientNotFound(): ApplicationError {
  return new ApplicationError({
    code: "EMBEDDED_CLIENT_NOT_FOUND",
    message: "嵌入客户端不存在。",
    status: 404,
    expose: true,
  });
}

function invalidClientOperation(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_EMBEDDED_CLIENT",
    message: "嵌入客户端配置无效。",
    status: 400,
    expose: true,
  });
}

function invalidClientCredentials(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_CLIENT_CREDENTIALS",
    message: "客户端认证失败。",
    status: 401,
    expose: true,
  });
}

function invalidTicketRequest(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_TICKET_REQUEST",
    message: "票据申请无效。",
    status: 400,
    expose: true,
  });
}

function invalidTicket(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_EMBEDDED_TICKET",
    message: "嵌入票据无效或已过期。",
    status: 401,
    expose: true,
  });
}

function integrationFailure(): ApplicationError {
  return new ApplicationError({
    code: "EMBEDDED_INTEGRATION_FAILURE",
    message: "嵌入认证失败。",
  });
}
