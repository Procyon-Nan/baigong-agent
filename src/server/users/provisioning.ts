import "server-only";

import { randomUUID } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import {
  normalizeDisplayName,
  normalizeLoginIdentifier,
} from "@/src/server/auth/identifiers";
import {
  generateTemporaryPassword,
  hashPassword,
} from "@/src/server/auth/password";
import {
  assertAdminPrincipal,
  type AdminPrincipal,
} from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import {
  authAccounts,
  authUsers,
  userProfiles,
} from "@/src/server/db/schema";
import type { UserRole } from "@/src/server/domain/identity";
import { ApplicationError } from "@/src/server/errors";
import { ensureDefaultTenant } from "./default-tenant";
import type {
  CreateLocalUserResult,
  LocalUserFields,
} from "./types";

type InitialAdministratorInput = LocalUserFields & {
  readonly role: "ADMIN";
  readonly actor?: undefined;
};

type ManagedLocalUserInput = LocalUserFields & {
  readonly actor: AdminPrincipal;
};

export async function createLocalUser(
  input: InitialAdministratorInput | ManagedLocalUserInput,
): Promise<CreateLocalUserResult> {
  if (input.actor) assertAdminPrincipal(input.actor);
  if (!input.actor && input.role !== "ADMIN") {
    throw invalidInitialAdministrator();
  }

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
  const [result] = await getDatabase()
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
    !(input.role === "USER" || input.role === "ADMIN")
  ) {
    throw new ApplicationError({
      code: "INVALID_LOCAL_USER",
      message: "用户资料无效。",
      status: 400,
      expose: true,
    });
  }
}

function invalidInitialAdministrator(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_INITIAL_ADMINISTRATOR",
    message: "初始化入口只能创建管理员。",
    status: 400,
    expose: true,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "23505";
}
