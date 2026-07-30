import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import { opaqueToken, sha256 } from "@/src/server/auth/identifiers";
import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
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
import {
  integrationFailure,
  invalidClientOperation,
  invalidTicket,
} from "./errors";
import {
  EMBEDDED_SESSION_LIFETIME_MS,
  type EmbeddedSessionResult,
  type IntegrationTransaction,
} from "./types";

export async function exchangeEmbeddedTicket(input: {
  readonly ticket: string;
  readonly origin: string;
  readonly previousPrincipal: AuthenticatedPrincipal | null;
}): Promise<EmbeddedSessionResult> {
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
      .select({
        status: userProfiles.status,
        displayName: userProfiles.displayName,
        displayEmail: userProfiles.displayEmail,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, identity.userId))
      .limit(1)
      .for("update");
    if (!profile || profile.status !== "ACTIVE") throw invalidTicket();
    await transaction
      .update(userProfiles)
      .set({
        displayName: ticket.displayName ?? profile.displayName,
        displayEmail: ticket.displayEmail ?? profile.displayEmail,
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
