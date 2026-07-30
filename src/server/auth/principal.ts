import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";
import { getDatabase } from "@/src/server/db/client";
import {
  embeddedClients,
  embeddedSessions,
  userProfiles,
} from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import { getAuth } from "./config";

export type UserRole = "USER" | "ADMIN";
export type IdentitySource = "LOCAL" | "EMBEDDED";

export type AuthenticatedPrincipal = {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: UserRole;
  readonly source: IdentitySource;
  readonly sessionId: string;
  readonly integrationId: string | null;
  readonly displayName: string;
  readonly mustChangePassword: boolean;
};

export async function resolvePrincipal(
  headers: Headers,
): Promise<AuthenticatedPrincipal | null> {
  const auth = await getAuth();
  const authenticated = await auth.api.getSession({ headers });
  if (!authenticated) return null;

  const bearerRequest =
    headers.get("authorization")?.toLowerCase().startsWith("bearer ") ?? false;
  const database = getDatabase();
  const [profile] = await database
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, authenticated.user.id))
    .limit(1);

  if (!profile || profile.status !== "ACTIVE") return null;
  if (bearerRequest !== (profile.source === "EMBEDDED")) return null;

  let integrationId: string | null = null;
  if (profile.source === "EMBEDDED") {
    const [embeddedSession] = await database
      .select({ integrationId: embeddedSessions.integrationId })
      .from(embeddedSessions)
      .innerJoin(
        embeddedClients,
        eq(embeddedClients.id, embeddedSessions.integrationId),
      )
      .where(
        and(
          eq(embeddedSessions.sessionId, authenticated.session.id),
          eq(embeddedSessions.userId, authenticated.user.id),
          isNull(embeddedSessions.revokedAt),
          gt(embeddedSessions.expiresAt, new Date()),
          eq(embeddedClients.status, "ACTIVE"),
        ),
      )
      .limit(1);
    if (!embeddedSession) return null;
    integrationId = embeddedSession.integrationId;
  }

  return {
    userId: profile.userId,
    tenantId: profile.tenantId,
    role: profile.role as UserRole,
    source: profile.source as IdentitySource,
    sessionId: authenticated.session.id,
    integrationId,
    displayName: profile.displayName,
    mustChangePassword: profile.mustChangePassword,
  };
}

export async function requirePrincipal(
  headers: Headers,
  options: { readonly allowPasswordChange?: boolean } = {},
): Promise<AuthenticatedPrincipal> {
  const principal = await resolvePrincipal(headers);
  if (!principal) throw unauthenticated();
  if (principal.mustChangePassword && !options.allowPasswordChange) {
    throw new ApplicationError({
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "必须先修改临时密码。",
      status: 403,
      expose: true,
    });
  }
  return principal;
}

export async function requireAdmin(
  headers: Headers,
): Promise<AuthenticatedPrincipal> {
  const principal = await requirePrincipal(headers);
  if (principal.role !== "ADMIN" || principal.source !== "LOCAL") {
    throw new ApplicationError({
      code: "ADMIN_REQUIRED",
      message: "无权访问该管理功能。",
      status: 403,
      expose: true,
    });
  }
  return principal;
}

function unauthenticated(): ApplicationError {
  return new ApplicationError({
    code: "AUTHENTICATION_REQUIRED",
    message: "请先登录。",
    status: 401,
    expose: true,
  });
}
