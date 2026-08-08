import { and, eq } from "drizzle-orm";
import { getDatabase, type Database } from "@/src/server/db/client";
import {
  conversationTurns,
  conversations,
  embeddedClients,
  externalIdentities,
  userProfiles,
} from "@/src/server/db/schema";
import type { VerifiedEveServiceToken } from "./tokens";

export async function authorizeEveServiceRequest(
  claims: VerifiedEveServiceToken,
  request: Request,
  database: Database = getDatabase(),
): Promise<boolean> {
  const [row] = await database
    .select({
      profileRole: userProfiles.role,
      profileSource: userProfiles.source,
      profileStatus: userProfiles.status,
      clientStatus: embeddedClients.status,
      conversationStatus: conversations.status,
      activeTurnId: conversations.activeTurnId,
      eveSessionId: conversations.eveSessionId,
    })
    .from(userProfiles)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, claims.conversationId),
        eq(conversations.tenantId, userProfiles.tenantId),
        eq(conversations.ownerUserId, userProfiles.userId),
        eq(conversations.ownerSource, userProfiles.source),
      ),
    )
    .innerJoin(
      conversationTurns,
      and(
        eq(conversationTurns.id, claims.turnId),
        eq(conversationTurns.conversationId, conversations.id),
        eq(conversationTurns.tenantId, conversations.tenantId),
        eq(conversationTurns.ownerUserId, conversations.ownerUserId),
        eq(
          conversationTurns.modelConfigVersionId,
          claims.modelConfigVersionId,
        ),
        eq(
          conversationTurns.agentConfigVersionId,
          claims.agentConfigVersionId,
        ),
      ),
    )
    .leftJoin(
      externalIdentities,
      eq(externalIdentities.userId, userProfiles.userId),
    )
    .leftJoin(
      embeddedClients,
      and(
        eq(embeddedClients.id, externalIdentities.integrationId),
        eq(embeddedClients.tenantId, userProfiles.tenantId),
      ),
    )
    .where(
      and(
        eq(userProfiles.userId, claims.userId),
        eq(userProfiles.tenantId, claims.tenantId),
      ),
    )
    .limit(1);

  return row ? isEveServiceRequestAllowed(claims, request, row) : false;
}

type EveAuthorizationSnapshot = {
  readonly profileRole: "USER" | "ADMIN";
  readonly profileSource: "LOCAL" | "EMBEDDED";
  readonly profileStatus: "ACTIVE" | "DISABLED";
  readonly clientStatus: "ACTIVE" | "DISABLED" | "DELETED" | null;
  readonly conversationStatus: string;
  readonly activeTurnId: string | null;
  readonly eveSessionId: string | null;
};

function isEveServiceRequestAllowed(
  claims: VerifiedEveServiceToken,
  request: Request,
  authority: EveAuthorizationSnapshot,
): boolean {
  if (!requestMatchesConversation(request, authority, claims.turnId)) {
    return false;
  }

  const cancellationAccess =
    isCancellationRequest(request) ||
    (authority.conversationStatus === "CANCELLING" &&
      isCancellationObservationRequest(request));
  if (cancellationAccess) {
    return (
      authority.conversationStatus === "CANCELLING" &&
      authority.activeTurnId === claims.turnId &&
      authority.profileSource === claims.source
    );
  }

  return (
    authority.profileStatus === "ACTIVE" &&
    authority.profileRole === claims.role &&
    authority.profileSource === claims.source &&
    (claims.source === "LOCAL" || authority.clientStatus === "ACTIVE")
  );
}

function requestMatchesConversation(
  request: Request,
  conversation: {
    readonly activeTurnId: string | null;
    readonly eveSessionId: string | null;
    readonly conversationStatus: string;
  },
  turnId: string,
): boolean {
  const path = new URL(request.url).pathname;
  if (request.method === "POST" && path === "/eve/v1/session") {
    return (
      conversation.conversationStatus === "STARTING" &&
      conversation.activeTurnId === turnId &&
      conversation.eveSessionId === null
    );
  }

  const sessionPath = path.match(
    /^\/eve\/v1\/session\/([^/]+)(?:\/(cancel|stream))?$/,
  );
  if (!sessionPath || !conversation.eveSessionId) return path === "/eve/v1/info";
  let pathSessionId: string;
  try {
    pathSessionId = decodeURIComponent(sessionPath[1] ?? "");
  } catch {
    return false;
  }
  if (pathSessionId !== conversation.eveSessionId) return false;
  if (sessionPath[2] === "stream") return request.method === "GET";
  if (sessionPath[2] === "cancel") return request.method === "POST";
  return (
    request.method === "POST" &&
    conversation.conversationStatus === "RUNNING" &&
    conversation.activeTurnId === turnId
  );
}

function isCancellationRequest(request: Request): boolean {
  return (
    request.method === "POST" &&
    /^\/eve\/v1\/session\/[^/]+\/cancel$/.test(new URL(request.url).pathname)
  );
}

function isCancellationObservationRequest(request: Request): boolean {
  return (
    request.method === "GET" &&
    /^\/eve\/v1\/session\/[^/]+\/stream$/.test(new URL(request.url).pathname)
  );
}
