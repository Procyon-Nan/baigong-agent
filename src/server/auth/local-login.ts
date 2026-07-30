import "server-only";

import { and, eq, or } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import { getDatabase } from "@/src/server/db/client";
import { authSessions, authUsers, userProfiles } from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import { ensureDefaultTenant } from "@/src/server/users/default-tenant";
import { getAuth } from "./config";
import { normalizeLoginIdentifier } from "./identifiers";
import {
  clearLoginFailures,
  consumeLoginSourceAttempt,
  isLoginIdentifierRestricted,
  recordLoginFailure,
  requestSource,
} from "./login-protection";

const GENERIC_LOGIN_ERROR = "用户名、邮箱或密码不正确。";

export async function loginWithIdentifier(
  request: Request,
  identifierInput: string,
  password: string,
): Promise<Response> {
  const identifier = normalizeLoginIdentifier(identifierInput);
  if (
    !identifier ||
    !password ||
    identifier.length > 254 ||
    password.length > 128
  ) {
    throw genericLoginError();
  }

  try {
    await consumeLoginSourceAttempt(requestSource(request));
  } catch (error) {
    await auditLogin(identifier, "DENIED", true);
    throw error;
  }
  if (await isLoginIdentifierRestricted(identifier)) {
    await auditLogin(identifier, "DENIED", true);
    throw genericLoginError();
  }

  const signInPath = identifier.includes("@")
    ? "/api/auth/sign-in/email"
    : "/api/auth/sign-in/username";
  const field = identifier.includes("@")
    ? { email: identifier }
    : { username: identifier };
  const auth = await getAuth();
  const authRequest = new Request(new URL(signInPath, request.url), {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ ...field, password, rememberMe: true }),
  });
  authRequest.headers.set("content-type", "application/json");
  const authResponse = await auth.handler(authRequest);

  if (!authResponse.ok) {
    const restricted = await recordLoginFailure(identifier);
    await auditLogin(identifier, "FAILURE", restricted);
    throw genericLoginError();
  }

  const payload = (await authResponse.json()) as {
    readonly token?: string;
    readonly user?: { readonly id?: string };
  };
  if (!payload.token || !payload.user?.id) {
    throw new ApplicationError({
      code: "INVALID_AUTH_RESPONSE",
      message: "认证服务响应无效。",
    });
  }

  const database = getDatabase();
  const [profile] = await database
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, payload.user.id))
    .limit(1);
  if (!profile || profile.source !== "LOCAL" || profile.status !== "ACTIVE") {
    await database
      .delete(authSessions)
      .where(eq(authSessions.token, payload.token));
    await recordLoginFailure(identifier);
    await auditLogin(
      identifier,
      "DENIED",
      false,
      profile?.tenantId,
      profile?.userId,
    );
    throw genericLoginError();
  }

  await database
    .update(userProfiles)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(userProfiles.userId, profile.userId));
  await clearLoginFailures(identifier);
  await writeSecurityAudit(database, {
    tenantId: profile.tenantId,
    actorUserId: profile.userId,
    actorSource: "LOCAL",
    action: "LOGIN_SUCCEEDED",
    targetType: "USER",
    targetId: profile.userId,
    outcome: "SUCCESS",
  });

  const headers = new Headers({ "content-type": "application/json" });
  const setCookie = authResponse.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(
    JSON.stringify({
      user: {
        id: profile.userId,
        displayName: profile.displayName,
        role: profile.role,
        mustChangePassword: profile.mustChangePassword,
      },
    }),
    { status: 200, headers },
  );
}

async function auditLogin(
  identifier: string,
  outcome: "FAILURE" | "DENIED",
  restricted: boolean,
  knownTenantId?: string,
  knownUserId?: string,
): Promise<void> {
  const database = getDatabase();
  let tenantId = knownTenantId;
  let userId = knownUserId;
  if (!tenantId) {
    const [known] = await database
      .select({ tenantId: userProfiles.tenantId, userId: userProfiles.userId })
      .from(authUsers)
      .innerJoin(userProfiles, eq(userProfiles.userId, authUsers.id))
      .where(
        or(eq(authUsers.email, identifier), eq(authUsers.username, identifier)),
      )
      .limit(1);
    tenantId = known?.tenantId;
    userId = known?.userId;
  }
  tenantId ??= await ensureDefaultTenant();
  await writeSecurityAudit(database, {
    tenantId,
    actorUserId: userId,
    actorSource: "SYSTEM",
    action: restricted ? "LOGIN_RESTRICTED" : "LOGIN_FAILED",
    targetType: "LOGIN_IDENTIFIER",
    targetId: null,
    outcome,
    metadata: { identifierDigestOnly: true },
  });
}

function genericLoginError(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_LOGIN",
    message: GENERIC_LOGIN_ERROR,
    status: 401,
    expose: true,
  });
}
