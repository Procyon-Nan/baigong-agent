import "server-only";

import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import {
  generateTemporaryPassword,
  hashPassword,
  validatePassword,
  verifyPassword,
} from "@/src/server/auth/password";
import {
  normalizeDisplayName,
  normalizeLoginIdentifier,
} from "@/src/server/auth/identifiers";
import type {
  AuthenticatedPrincipal,
  UserRole,
} from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import {
  authAccounts,
  authSessions,
  authUsers,
  embeddedSessions,
  userProfiles,
} from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";
import { ensureDefaultTenant } from "./default-tenant";

export type ManagedUser = {
  readonly id: string;
  readonly username: string | null;
  readonly email: string | null;
  readonly displayName: string;
  readonly source: "LOCAL" | "EMBEDDED";
  readonly role: UserRole;
  readonly status: "ACTIVE" | "DISABLED";
  readonly mustChangePassword: boolean;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
};

export async function listUsers(tenantId: string): Promise<ManagedUser[]> {
  const database = getDatabase();
  const rows = await database
    .select({
      id: authUsers.id,
      username: authUsers.username,
      internalEmail: authUsers.email,
      displayName: userProfiles.displayName,
      displayEmail: userProfiles.displayEmail,
      source: userProfiles.source,
      role: userProfiles.role,
      status: userProfiles.status,
      mustChangePassword: userProfiles.mustChangePassword,
      lastLoginAt: userProfiles.lastLoginAt,
      createdAt: userProfiles.createdAt,
    })
    .from(userProfiles)
    .innerJoin(authUsers, eq(authUsers.id, userProfiles.userId))
    .where(eq(userProfiles.tenantId, tenantId))
    .orderBy(userProfiles.createdAt);

  return rows.map((row) => ({
    id: row.id,
    username: row.source === "LOCAL" ? row.username : null,
    email: row.source === "LOCAL" ? row.internalEmail : row.displayEmail,
    displayName: row.displayName,
    source: row.source as ManagedUser["source"],
    role: row.role as UserRole,
    status: row.status as ManagedUser["status"],
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  }));
}

export async function createLocalUser(input: {
  readonly username: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly actor?: AuthenticatedPrincipal;
}): Promise<{
  readonly user: ManagedUser;
  readonly temporaryPassword: string;
}> {
  const username = normalizeLoginIdentifier(input.username);
  const email = normalizeLoginIdentifier(input.email);
  const displayName = normalizeDisplayName(input.displayName);
  validateLocalUserInput({ username, email, displayName, role: input.role });

  const tenantId = input.actor?.tenantId ?? (await ensureDefaultTenant());
  const userId = randomUUID();
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const now = new Date();
  const database = getDatabase();

  try {
    await database.transaction(async (transaction) => {
      if (!input.actor) {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext(${tenantId}))`,
        );
        const [administratorCount] = await transaction
          .select({ value: count() })
          .from(userProfiles)
          .where(
            and(
              eq(userProfiles.tenantId, tenantId),
              eq(userProfiles.source, "LOCAL"),
              eq(userProfiles.role, "ADMIN"),
              eq(userProfiles.status, "ACTIVE"),
            ),
          );
        if ((administratorCount?.value ?? 0) > 0) {
          throw new ApplicationError({
            code: "INITIAL_ADMINISTRATOR_EXISTS",
            message: "已存在有效本地管理员，初始化已拒绝。",
            status: 409,
            expose: true,
          });
        }
      }
      await transaction.insert(authUsers).values({
        id: userId,
        name: displayName,
        email,
        emailVerified: true,
        username,
        displayUsername: username,
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(authAccounts).values({
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(userProfiles).values({
        userId,
        tenantId,
        source: "LOCAL",
        role: input.role,
        status: "ACTIVE",
        displayName,
        displayEmail: email,
        mustChangePassword: true,
        createdAt: now,
        updatedAt: now,
      });
      await writeSecurityAudit(transaction, {
        tenantId,
        actorUserId: input.actor?.userId,
        actorSource: input.actor ? "LOCAL" : "SYSTEM",
        action: input.actor ? "USER_CREATED" : "INITIAL_ADMIN_CREATED",
        targetType: "USER",
        targetId: userId,
        outcome: "SUCCESS",
        metadata: { role: input.role },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApplicationError({
        code: "LOGIN_IDENTIFIER_CONFLICT",
        message: "用户名或邮箱已被使用。",
        status: 409,
        expose: true,
        cause: error,
      });
    }
    throw error;
  }

  return {
    user: {
      id: userId,
      username,
      email,
      displayName,
      source: "LOCAL",
      role: input.role,
      status: "ACTIVE",
      mustChangePassword: true,
      lastLoginAt: null,
      createdAt: now,
    },
    temporaryPassword,
  };
}

export async function hasActiveLocalAdministrator(): Promise<boolean> {
  const database = getDatabase();
  const [result] = await database
    .select({ value: count() })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.source, "LOCAL"),
        eq(userProfiles.role, "ADMIN"),
        eq(userProfiles.status, "ACTIVE"),
      ),
    );
  return (result?.value ?? 0) > 0;
}

export async function updateManagedUser(
  actor: AuthenticatedPrincipal,
  userId: string,
  update: { readonly status?: "ACTIVE" | "DISABLED"; readonly role?: UserRole },
): Promise<void> {
  if (!update.status && !update.role) {
    throw invalidUserOperation();
  }

  const database = getDatabase();
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
    if (target.source === "EMBEDDED" && update.role)
      throw invalidUserOperation();

    const nextRole = update.role ?? target.role;
    const nextStatus = update.status ?? target.status;
    const removesActiveAdmin =
      target.source === "LOCAL" &&
      target.role === "ADMIN" &&
      target.status === "ACTIVE" &&
      (nextRole !== "ADMIN" || nextStatus !== "ACTIVE");
    if (removesActiveAdmin)
      await assertAnotherActiveAdministrator(
        transaction,
        actor.tenantId,
        userId,
      );

    await transaction
      .update(userProfiles)
      .set({ role: nextRole, status: nextStatus, updatedAt: new Date() })
      .where(eq(userProfiles.userId, userId));

    if (nextRole !== target.role || nextStatus === "DISABLED") {
      await revokeUserSessions(transaction, userId);
    }
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
}

export async function resetManagedUserPassword(
  actor: AuthenticatedPrincipal,
  userId: string,
): Promise<string> {
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
  return temporaryPassword;
}

export async function revokeManagedUserSessions(
  actor: AuthenticatedPrincipal,
  userId: string,
): Promise<void> {
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

function validateLocalUserInput(input: {
  username: string;
  email: string;
  displayName: string;
  role: UserRole;
}): void {
  if (
    !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(input.username) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
    input.email.length > 254 ||
    input.displayName.length < 1 ||
    input.displayName.length > 120 ||
    !(["USER", "ADMIN"] as string[]).includes(input.role)
  ) {
    throw new ApplicationError({
      code: "INVALID_LOCAL_USER",
      message: "用户资料无效。",
      status: 400,
      expose: true,
    });
  }
}

async function assertAnotherActiveAdministrator(
  transaction: Parameters<
    Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
  >[0],
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

async function revokeUserSessions(
  transaction: Parameters<
    Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
  >[0],
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

function userNotFound(): ApplicationError {
  return new ApplicationError({
    code: "USER_NOT_FOUND",
    message: "用户不存在。",
    status: 404,
    expose: true,
  });
}

function invalidUserOperation(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_USER_OPERATION",
    message: "该用户不支持此操作。",
    status: 400,
    expose: true,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "23505";
}
