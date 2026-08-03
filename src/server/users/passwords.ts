import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import {
  generateTemporaryPassword,
  hashPassword,
  validatePassword,
  verifyPassword,
} from "@/src/server/auth/password";
import {
  assertAdminPrincipal,
  type AdminPrincipal,
  type AuthenticatedPrincipal,
} from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import {
  authAccounts,
  authSessions,
  userProfiles,
} from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import { cancelActiveRepliesForUser } from "@/src/server/conversations/identity-cancellation";
import { invalidUserOperation, userNotFound } from "./errors";
import { revokeUserSessions } from "./management";

export async function resetManagedUserPassword(
  actor: AdminPrincipal,
  userId: string,
): Promise<string> {
  assertAdminPrincipal(actor);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const [target] = await transaction
      .select({ source: userProfiles.source })
      .from(userProfiles)
      .where(
        and(
          eq(userProfiles.userId, userId),
          eq(userProfiles.tenantId, actor.tenantId),
        ),
      )
      .limit(1)
      .for("update");
    if (!target) throw userNotFound();
    if (target.source !== "LOCAL") throw invalidUserOperation();

    await transaction
      .update(authAccounts)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(
        and(
          eq(authAccounts.userId, userId),
          eq(authAccounts.providerId, "credential"),
        ),
      );
    await transaction
      .update(userProfiles)
      .set({ mustChangePassword: true, updatedAt: new Date() })
      .where(eq(userProfiles.userId, userId));
    await revokeUserSessions(transaction, userId);
    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: "USER_PASSWORD_RESET",
      targetType: "USER",
      targetId: userId,
      outcome: "SUCCESS",
    });
  });
  await cancelActiveRepliesForUser(actor, userId, "USER_PASSWORD_RESET");
  return temporaryPassword;
}

export async function changeOwnPassword(
  principal: AuthenticatedPrincipal,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (principal.source !== "LOCAL") throw invalidUserOperation();
  validatePassword(newPassword);
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const [account] = await transaction
      .select({ password: authAccounts.password })
      .from(authAccounts)
      .where(
        and(
          eq(authAccounts.userId, principal.userId),
          eq(authAccounts.providerId, "credential"),
        ),
      )
      .limit(1)
      .for("update");
    if (
      !account?.password ||
      !(await verifyPassword(account.password, currentPassword))
    ) {
      throw new ApplicationError({
        code: "CURRENT_PASSWORD_INVALID",
        message: "当前密码不正确。",
        status: 400,
        expose: true,
      });
    }

    const passwordHash = await hashPassword(newPassword);
    await transaction
      .update(authAccounts)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(
        and(
          eq(authAccounts.userId, principal.userId),
          eq(authAccounts.providerId, "credential"),
        ),
      );
    await transaction
      .update(userProfiles)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(userProfiles.userId, principal.userId));
    await transaction
      .delete(authSessions)
      .where(
        and(
          eq(authSessions.userId, principal.userId),
          sql`${authSessions.id} <> ${principal.sessionId}`,
        ),
      );
    await writeSecurityAudit(transaction, {
      tenantId: principal.tenantId,
      actorUserId: principal.userId,
      actorSource: "LOCAL",
      action: "PASSWORD_CHANGED",
      targetType: "USER",
      targetId: principal.userId,
      outcome: "SUCCESS",
    });
  });
}
