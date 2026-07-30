import "server-only";

import { eq } from "drizzle-orm";
import {
  assertAdminPrincipal,
  type AdminPrincipal,
} from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import { authUsers, userProfiles } from "@/src/server/db/schema";
import type { ManagedUser } from "./types";

export async function listUsers(
  principal: AdminPrincipal,
): Promise<ManagedUser[]> {
  assertAdminPrincipal(principal);
  const rows = await getDatabase()
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
    .where(eq(userProfiles.tenantId, principal.tenantId))
    .orderBy(userProfiles.createdAt);

  return rows.map((row) => ({
    id: row.id,
    username: row.source === "LOCAL" ? row.username : null,
    email: row.source === "LOCAL" ? row.internalEmail : row.displayEmail,
    displayName: row.displayName,
    source: row.source,
    role: row.role,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  }));
}
