import "server-only";

import { and, eq, or } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import type { Database } from "@/src/server/db/client";
import { conversations, userProfiles } from "@/src/server/db/schema";

export type OwnerPrincipal = Pick<
  AuthenticatedPrincipal,
  "tenantId" | "userId" | "source"
>;

export async function findAccessibleConversation(
  database: Pick<Database, "select">,
  principal: OwnerPrincipal,
  conversationId: string,
) {
  const [conversation] = await database
    .select()
    .from(conversations)
    .where(
      and(
        ownerScope(principal),
        eq(conversations.id, conversationId),
        or(
          eq(conversations.kind, "MAIN"),
          and(
            eq(conversations.kind, "SUBAGENT"),
            eq(conversations.linkStatus, "VERIFIED"),
          ),
        ),
      ),
    )
    .limit(1);
  return conversation;
}

export async function findOwnedMainConversation(
  database: Pick<Database, "select">,
  principal: OwnerPrincipal,
  conversationId: string,
) {
  const [conversation] = await database
    .select()
    .from(conversations)
    .where(
      and(
        ownerScope(principal),
        eq(conversations.id, conversationId),
        eq(conversations.kind, "MAIN"),
      ),
    )
    .limit(1);
  return conversation;
}

export async function lockConversationOwner(
  transaction: Pick<Database, "select">,
  principal: OwnerPrincipal,
): Promise<void> {
  await transaction
    .select({ id: userProfiles.userId })
    .from(userProfiles)
    .where(eq(userProfiles.userId, principal.userId))
    .limit(1)
    .for("update");
}

export function ownerScope(principal: OwnerPrincipal) {
  return and(
    eq(conversations.tenantId, principal.tenantId),
    eq(conversations.ownerUserId, principal.userId),
    eq(conversations.ownerSource, principal.source),
  );
}
