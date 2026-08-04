import "server-only";

import { and, count, eq, isNull } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import type { Database } from "@/src/server/db/client";
import { conversations } from "@/src/server/db/schema";
import { conversationQuotaExceeded } from "./errors";
import { MAX_MAIN_CONVERSATIONS_PER_USER } from "./types";

type OwnerPrincipal = Pick<
  AuthenticatedPrincipal,
  "tenantId" | "userId" | "source"
>;

export async function assertMainConversationQuota(
  database: Pick<Database, "select">,
  principal: OwnerPrincipal,
): Promise<void> {
  const [result] = await database
    .select({ value: count() })
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, principal.tenantId),
        eq(conversations.ownerUserId, principal.userId),
        eq(conversations.ownerSource, principal.source),
        eq(conversations.kind, "MAIN"),
        isNull(conversations.archivedAt),
      ),
    );
  if ((result?.value ?? 0) >= MAX_MAIN_CONVERSATIONS_PER_USER) {
    throw conversationQuotaExceeded();
  }
}
