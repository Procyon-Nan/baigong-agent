import "server-only";

import { and, eq } from "drizzle-orm";
import type { Database } from "@/src/server/db/client";
import { authUsers, conversations, userProfiles } from "@/src/server/db/schema";
import type { AdminConversationOwner } from "./admin-conversation-types";
import { conversationNotFound } from "./errors";

type AdminConversationOwnerRow = {
  readonly ownerUserId: string;
  readonly ownerDisplayName: string;
  readonly ownerDisplayEmail: string | null;
  readonly ownerSource: AdminConversationOwner["source"];
  readonly ownerUsername: string | null;
  readonly ownerEmail: string;
};

export type AdminConversationRow = AdminConversationOwnerRow & {
  readonly conversation: typeof conversations.$inferSelect;
};

export function adminConversationQuery(database: Pick<Database, "select">) {
  return database
    .select({
      conversation: conversations,
      ownerUserId: userProfiles.userId,
      ownerDisplayName: userProfiles.displayName,
      ownerDisplayEmail: userProfiles.displayEmail,
      ownerSource: userProfiles.source,
      ownerUsername: authUsers.username,
      ownerEmail: authUsers.email,
    })
    .from(conversations)
    .innerJoin(
      userProfiles,
      and(
        eq(userProfiles.userId, conversations.ownerUserId),
        eq(userProfiles.tenantId, conversations.tenantId),
        eq(userProfiles.source, conversations.ownerSource),
      ),
    )
    .innerJoin(authUsers, eq(authUsers.id, conversations.ownerUserId));
}

export function toAdminConversationOwner(
  row: AdminConversationOwnerRow,
): AdminConversationOwner {
  return {
    userId: row.ownerUserId,
    displayName: row.ownerDisplayName,
    identifier:
      row.ownerUsername ??
      row.ownerDisplayEmail ??
      row.ownerEmail ??
      row.ownerUserId,
    source: row.ownerSource,
  };
}

export async function readAdminConversationOwner(
  database: Pick<Database, "select">,
  userId: string,
): Promise<AdminConversationOwner> {
  const [row] = await database
    .select({
      ownerUserId: userProfiles.userId,
      ownerDisplayName: userProfiles.displayName,
      ownerDisplayEmail: userProfiles.displayEmail,
      ownerSource: userProfiles.source,
      ownerUsername: authUsers.username,
      ownerEmail: authUsers.email,
    })
    .from(userProfiles)
    .innerJoin(authUsers, eq(authUsers.id, userProfiles.userId))
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  if (!row) throw conversationNotFound();
  return toAdminConversationOwner(row);
}
