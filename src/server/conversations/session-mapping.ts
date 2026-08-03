import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDatabase, type Database } from "@/src/server/db/client";
import { conversationTurns, conversations } from "@/src/server/db/schema";
import { conversationPersistenceFailure } from "./errors";

const serviceSessionIdentitySchema = z.strictObject({
  authenticator: z.literal("baigong-bff"),
  principalId: z.string().min(1),
  attributes: z.strictObject({
    tenantId: z.uuid(),
    role: z.enum(["USER", "ADMIN"]),
    source: z.enum(["LOCAL", "EMBEDDED"]),
    conversationId: z.uuid(),
    turnId: z.uuid(),
    modelConfigVersionId: z.uuid(),
  }),
});

export type ServiceSessionIdentity = z.output<
  typeof serviceSessionIdentitySchema
>;

export function parseServiceSessionIdentity(input: unknown): ServiceSessionIdentity {
  return serviceSessionIdentitySchema.parse(input);
}

export async function recoverConversationSessionMapping(
  identity: ServiceSessionIdentity,
  eveSessionId: string,
  database: Database = getDatabase(),
): Promise<void> {
  await database.transaction(async (transaction) => {
    const [mapping] = await transaction
      .select({
        conversation: conversations,
        modelConfigVersionId: conversationTurns.modelConfigVersionId,
        turnOwnerUserId: conversationTurns.ownerUserId,
        turnStatus: conversationTurns.status,
      })
      .from(conversations)
      .innerJoin(
        conversationTurns,
        and(
          eq(conversationTurns.id, identity.attributes.turnId),
          eq(conversationTurns.conversationId, conversations.id),
          eq(conversationTurns.tenantId, conversations.tenantId),
        ),
      )
      .where(
        and(
          eq(conversations.id, identity.attributes.conversationId),
          eq(conversations.tenantId, identity.attributes.tenantId),
        ),
      )
      .limit(1)
      .for("update");

    if (
      !mapping ||
      mapping.conversation.ownerUserId !== identity.principalId ||
      mapping.turnOwnerUserId !== identity.principalId ||
      mapping.conversation.ownerSource !== identity.attributes.source ||
      mapping.conversation.activeTurnId !== identity.attributes.turnId ||
      mapping.modelConfigVersionId !== identity.attributes.modelConfigVersionId ||
      !isRecoverableMappingState(mapping, eveSessionId)
    ) {
      throw conversationPersistenceFailure();
    }

    if (mapping.conversation.eveSessionId === eveSessionId) return;
    const [updated] = await transaction
      .update(conversations)
      .set({ eveSessionId, updatedAt: new Date() })
      .where(
        and(
          eq(conversations.id, identity.attributes.conversationId),
          eq(conversations.tenantId, identity.attributes.tenantId),
          eq(conversations.activeTurnId, identity.attributes.turnId),
        ),
      )
      .returning({ id: conversations.id });
    if (!updated) throw conversationPersistenceFailure();
  });
}

function isRecoverableMappingState(
  mapping: {
    readonly conversation: typeof conversations.$inferSelect;
    readonly turnStatus: typeof conversationTurns.$inferSelect.status;
  },
  eveSessionId: string,
): boolean {
  if (mapping.conversation.eveSessionId === null) {
    return (
      mapping.conversation.status === "STARTING" &&
      mapping.turnStatus === "SUBMITTING"
    );
  }
  return (
    mapping.conversation.eveSessionId === eveSessionId &&
    ((mapping.conversation.status === "STARTING" &&
      mapping.turnStatus === "SUBMITTING") ||
      (mapping.conversation.status === "RUNNING" &&
        mapping.turnStatus === "RUNNING"))
  );
}
