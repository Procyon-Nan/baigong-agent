import "server-only";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import { opaqueToken, sha256 } from "@/src/server/auth/identifiers";
import { consumeLoginSourceAttempt } from "@/src/server/auth/login-protection";
import { hashPassword, verifyPassword } from "@/src/server/auth/password";
import { getDatabase } from "@/src/server/db/client";
import { embeddedClients, embeddedTickets } from "@/src/server/db/schema";
import { ensureDefaultTenant } from "@/src/server/users/default-tenant";
import {
  invalidClientCredentials,
  invalidTicketRequest,
} from "./errors";
import { EMBEDDED_TICKET_LIFETIME_MS } from "./types";

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
  if (!externalUserId || externalUserId.length > 255) {
    throw invalidTicketRequest();
  }
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
  const expiresAt = new Date(Date.now() + EMBEDDED_TICKET_LIFETIME_MS);
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
