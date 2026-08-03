import { and, eq } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import type { AdminPrincipal } from "@/src/server/auth/principal";
import { getDatabase, type Database } from "@/src/server/db/client";
import { conversations } from "@/src/server/db/schema";
import {
  conversationNotFound,
  conversationUnavailable,
} from "@/src/server/conversations/errors";
import {
  issueEveAdminStreamToken,
  type EveAdminStreamTokenInput,
  type IssuedEveToken,
  type VerifiedEveAdminStreamToken,
} from "./tokens";

export type AdminStreamTarget = {
  readonly conversationId: string;
  readonly eveSessionId: string;
  readonly ownerUserId: string;
};

export type AdminStreamClaims = Pick<
  VerifiedEveAdminStreamToken,
  "administratorUserId" | "conversationId" | "tenantId"
>;

export type AdminStreamRepository = ReturnType<
  typeof createAdminStreamRepository
>;

export function createAdminStreamRepository(
  database: Database = getDatabase(),
) {
  return {
    async findTarget(
      tenantId: string,
      conversationId: string,
    ): Promise<AdminStreamTarget | null> {
      const [conversation] = await database
        .select({
          conversationId: conversations.id,
          eveSessionId: conversations.eveSessionId,
          ownerUserId: conversations.ownerUserId,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.id, conversationId),
          ),
        )
        .limit(1);
      if (!conversation) return null;
      if (!conversation.eveSessionId) throw conversationUnavailable();
      return {
        conversationId: conversation.conversationId,
        eveSessionId: conversation.eveSessionId,
        ownerUserId: conversation.ownerUserId,
      };
    },

    recordTokenIssued(
      principal: AdminPrincipal,
      target: AdminStreamTarget,
    ): Promise<void> {
      return writeSecurityAudit(database, {
        tenantId: principal.tenantId,
        actorUserId: principal.userId,
        actorSource: "LOCAL",
        action: "ADMIN_STREAM_TOKEN_ISSUED",
        targetType: "CONVERSATION",
        targetId: target.conversationId,
        outcome: "SUCCESS",
        metadata: { ownerUserId: target.ownerUserId },
      });
    },

    recordStreamViewed(
      claims: AdminStreamClaims,
      target: AdminStreamTarget,
    ): Promise<void> {
      return writeSecurityAudit(database, {
        tenantId: claims.tenantId,
        actorUserId: claims.administratorUserId,
        actorSource: "LOCAL",
        action: "ADMIN_STREAM_VIEWED",
        targetType: "CONVERSATION",
        targetId: target.conversationId,
        outcome: "SUCCESS",
        metadata: { ownerUserId: target.ownerUserId },
      });
    },
  };
}

export async function issueAdminConversationStreamToken(
  principal: AdminPrincipal,
  conversationId: string,
  options: {
    readonly repository?: AdminStreamRepository;
    readonly issueToken?: (
      input: EveAdminStreamTokenInput,
    ) => Promise<IssuedEveToken>;
  } = {},
): Promise<IssuedEveToken> {
  const repository = options.repository ?? createAdminStreamRepository();
  const target = await repository.findTarget(
    principal.tenantId,
    conversationId,
  );
  if (!target) throw conversationNotFound();

  const issued = await (options.issueToken ?? issueEveAdminStreamToken)({
    administratorUserId: principal.userId,
    tenantId: principal.tenantId,
    conversationId: target.conversationId,
  });
  await repository.recordTokenIssued(principal, target);
  return issued;
}

export async function authorizeAdminConversationStream(
  claims: AdminStreamClaims,
  repository: AdminStreamRepository = createAdminStreamRepository(),
): Promise<AdminStreamTarget> {
  const target = await repository.findTarget(
    claims.tenantId,
    claims.conversationId,
  );
  if (!target) throw conversationNotFound();
  await repository.recordStreamViewed(claims, target);
  return target;
}
