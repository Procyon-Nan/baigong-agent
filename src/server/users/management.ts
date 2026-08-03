import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import {
  assertAdminPrincipal,
  type AdminPrincipal,
} from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import {
  authSessions,
  embeddedSessions,
  userProfiles,
} from "@/src/server/db/schema";
import type { UserRole } from "@/src/server/domain/identity";
import { ApplicationError } from "@/src/server/errors";
import { cancelActiveRepliesForUser } from "@/src/server/conversations/identity-cancellation";
import { invalidUserOperation, userNotFound } from "./errors";

type UserTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

export async function updateManagedUser(
  actor: AdminPrincipal,
  userId: string,
  update: { readonly status?: "ACTIVE" | "DISABLED"; readonly role?: UserRole },
): Promise<void> {
  assertAdminPrincipal(actor);
  if (!update.status && !update.role) throw invalidUserOperation();

  const database = getDatabase();
  let cancellationTrigger: "USER_DISABLED" | "USER_ROLE_CHANGED" | null = null;
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${actor.tenantId}))`,
    );
    const [target] = await transaction
      .select()
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
    if (target.source === "EMBEDDED" && update.role) {
      throw invalidUserOperation();
    }

    const nextRole = update.role ?? target.role;
    const nextStatus = update.status ?? target.status;
    const removesActiveAdmin =
      target.source === "LOCAL" &&
      target.role === "ADMIN" &&
      target.status === "ACTIVE" &&
      (nextRole !== "ADMIN" || nextStatus !== "ACTIVE");
    if (removesActiveAdmin) {
      await assertAnotherActiveAdministrator(
        transaction,
        actor.tenantId,
        userId,
      );
    }

    await transaction
      .update(userProfiles)
      .set({ role: nextRole, status: nextStatus, updatedAt: new Date() })
      .where(eq(userProfiles.userId, userId));

    if (nextRole !== target.role || nextStatus === "DISABLED") {
      await revokeUserSessions(transaction, userId);
    }
    cancellationTrigger =
      nextStatus === "DISABLED" && target.status !== "DISABLED"
        ? "USER_DISABLED"
        : nextRole !== target.role
          ? "USER_ROLE_CHANGED"
          : null;
    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: "USER_UPDATED",
      targetType: "USER",
      targetId: userId,
      outcome: "SUCCESS",
      metadata: {
        previousRole: target.role,
        role: nextRole,
        previousStatus: target.status,
        status: nextStatus,
      },
    });
  });
  if (cancellationTrigger) {
    await cancelActiveRepliesForUser(actor, userId, cancellationTrigger);
  }
}

export async function revokeManagedUserSessions(
  actor: AdminPrincipal,
  userId: string,
): Promise<void> {
  assertAdminPrincipal(actor);
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const [target] = await transaction
      .select({ id: userProfiles.userId })
      .from(userProfiles)
      .where(
        and(
          eq(userProfiles.userId, userId),
          eq(userProfiles.tenantId, actor.tenantId),
        ),
      )
      .limit(1);
    if (!target) throw userNotFound();
    await revokeUserSessions(transaction, userId);
    await writeSecurityAudit(transaction, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorSource: "LOCAL",
      action: "USER_SESSIONS_REVOKED",
      targetType: "USER",
      targetId: userId,
      outcome: "SUCCESS",
    });
  });
}

export async function revokeUserSessions(
  transaction: UserTransaction,
  userId: string,
): Promise<void> {
  const sessionRows = await transaction
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(eq(authSessions.userId, userId));
  const sessionIds = sessionRows.map((session) => session.id);
  if (sessionIds.length > 0) {
    await transaction
      .update(embeddedSessions)
      .set({ revokedAt: new Date() })
      .where(inArray(embeddedSessions.sessionId, sessionIds));
  }
  await transaction.delete(authSessions).where(eq(authSessions.userId, userId));
}

async function assertAnotherActiveAdministrator(
  transaction: UserTransaction,
  tenantId: string,
  excludedUserId: string,
): Promise<void> {
  const administrators = await transaction
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.tenantId, tenantId),
        eq(userProfiles.source, "LOCAL"),
        eq(userProfiles.role, "ADMIN"),
        eq(userProfiles.status, "ACTIVE"),
      ),
    )
    .for("update");
  if (
    !administrators.some(
      (administrator) => administrator.userId !== excludedUserId,
    )
  ) {
    throw new ApplicationError({
      code: "LAST_ACTIVE_ADMINISTRATOR",
      message: "不能停用或降级最后一名有效本地管理员。",
      status: 409,
      expose: true,
    });
  }
}
