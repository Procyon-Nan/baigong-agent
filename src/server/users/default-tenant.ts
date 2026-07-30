import "server-only";

import { eq } from "drizzle-orm";
import { getDatabase } from "@/src/server/db/client";
import { tenants } from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";

export const DEFAULT_TENANT_SLUG = "default";

export async function ensureDefaultTenant(): Promise<string> {
  const database = getDatabase();
  await database
    .insert(tenants)
    .values({ slug: DEFAULT_TENANT_SLUG, displayName: "默认租户" })
    .onConflictDoNothing({ target: tenants.slug });

  const [tenant] = await database
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, DEFAULT_TENANT_SLUG))
    .limit(1);
  if (!tenant) {
    throw new ApplicationError({
      code: "DEFAULT_TENANT_UNAVAILABLE",
      message: "默认租户不可用。",
    });
  }
  return tenant.id;
}
