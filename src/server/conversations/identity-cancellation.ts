import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import type { AdminPrincipal } from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import {
  conversationTurns,
  conversations,
  externalIdentities,
  userProfiles,
} from "@/src/server/db/schema";
import { operationalErrorMetadata } from "@/src/server/errors";
import { createEveGateway } from "@/src/server/eve/client";
import { monitorEveEvents } from "./lifecycle";
import { serviceIdentity } from "./creation";
import {
  createConversationRepository,
  type ConversationRepository,
} from "./repository";
import type { EveGateway, ReservedConversationTurn } from "./types";

const CANCELLABLE_CONVERSATION_STATUSES = [
  "STARTING",
  "RUNNING",
  "CANCELLING",
] as const;

type IdentityCancellationTrigger =
  | "USER_DISABLED"
  | "USER_ROLE_CHANGED"
  | "USER_PASSWORD_RESET"
  | "EMBEDDED_CLIENT_DISABLED"
  | "EMBEDDED_CLIENT_DELETED";

type IdentityCancellationReservation = ReservedConversationTurn & {
  readonly role: "USER" | "ADMIN";
  readonly eveSessionId: string;
};

type SettledIdentityCancellation = {
  readonly conversationId: string;
  readonly ownerUserId: string;
};

type IdentityCancellationDependencies = {
  readonly eve?: EveGateway;
  readonly repository?: Pick<
    ConversationRepository,
    "settleUnresolvedCancellation"
  >;
  readonly reserve?: typeof reserveIdentityCancellations;
  readonly recordAudit?: typeof recordIdentityCancellation;
  readonly monitor?: typeof monitorIdentityCancellation;
};

export async function cancelActiveRepliesForUser(
  actor: AdminPrincipal,
  userId: string,
  trigger: IdentityCancellationTrigger,
  dependencies: IdentityCancellationDependencies = {},
): Promise<void> {
  const pending = await (
    dependencies.reserve ?? reserveIdentityCancellations
  )(
    actor.tenantId,
    [userId],
  );
  await finishIdentityCancellations(actor, pending, trigger, dependencies);
}

export async function cancelActiveRepliesForEmbeddedClient(
  actor: AdminPrincipal,
  clientId: string,
  trigger: Extract<
    IdentityCancellationTrigger,
    "EMBEDDED_CLIENT_DISABLED" | "EMBEDDED_CLIENT_DELETED"
  >,
  dependencies: IdentityCancellationDependencies = {},
): Promise<void> {
  const database = getDatabase();
  const identities = await database
    .select({ userId: externalIdentities.userId })
    .from(externalIdentities)
    .where(eq(externalIdentities.integrationId, clientId));
  if (identities.length === 0) return;
  const pending = await (
    dependencies.reserve ?? reserveIdentityCancellations
  )(
    actor.tenantId,
    identities.map(({ userId }) => userId),
  );
  await finishIdentityCancellations(actor, pending, trigger, dependencies);
}

async function reserveIdentityCancellations(
  tenantId: string,
  userIds: readonly string[],
): Promise<{
  readonly reservations: IdentityCancellationReservation[];
  readonly settled: SettledIdentityCancellation[];
}> {
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select({
        conversation: conversations,
        turn: conversationTurns,
        role: userProfiles.role,
      })
      .from(conversations)
      .innerJoin(
        conversationTurns,
        eq(conversationTurns.id, conversations.activeTurnId),
      )
      .innerJoin(
        userProfiles,
        and(
          eq(userProfiles.userId, conversations.ownerUserId),
          eq(userProfiles.tenantId, conversations.tenantId),
        ),
      )
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          inArray(conversations.ownerUserId, userIds),
          inArray(conversations.status, CANCELLABLE_CONVERSATION_STATUSES),
        ),
      )
      .for("update");
    const reservations: IdentityCancellationReservation[] = [];
    const settled: SettledIdentityCancellation[] = [];
    const now = new Date();

    for (const { conversation, turn, role } of rows) {
      if (!conversation.eveSessionId) {
        await transaction
          .update(conversationTurns)
          .set({ status: "CANCELLED", completedAt: now, updatedAt: now })
          .where(eq(conversationTurns.id, turn.id));
        await transaction
          .update(conversations)
          .set({
            status: "TERMINAL_FAILED",
            activeTurnId: null,
            updatedAt: now,
          })
          .where(eq(conversations.id, conversation.id));
        settled.push({
          conversationId: conversation.id,
          ownerUserId: conversation.ownerUserId,
        });
        continue;
      }

      await transaction
        .update(conversationTurns)
        .set({ status: "CANCELLING", updatedAt: now })
        .where(eq(conversationTurns.id, turn.id));
      await transaction
        .update(conversations)
        .set({ status: "CANCELLING", updatedAt: now })
        .where(eq(conversations.id, conversation.id));
      reservations.push({
        conversationId: conversation.id,
        turnId: turn.id,
        tenantId: conversation.tenantId,
        ownerUserId: conversation.ownerUserId,
        ownerSource: conversation.ownerSource,
        modelConfigVersionId: turn.modelConfigVersionId,
        agentConfigVersionId: turn.agentConfigVersionId,
        eveTurnId: turn.eveTurnId,
        conversationStatus: "CANCELLING",
        turnStatus: "CANCELLING",
        eveSessionId: conversation.eveSessionId,
        encryptedContinuationToken: conversation.encryptedContinuationToken,
        continuationTokenRevision: conversation.continuationTokenRevision,
        nextStreamIndex:
          conversation.lastEveCursor === null
            ? 0
            : Number(conversation.lastEveCursor) + 1,
        createdAt: conversation.createdAt,
        updatedAt: now,
        role,
      });
    }
    return { reservations, settled };
  });
}

async function finishIdentityCancellations(
  actor: AdminPrincipal,
  pending: {
    readonly reservations: readonly IdentityCancellationReservation[];
    readonly settled: readonly SettledIdentityCancellation[];
  },
  trigger: IdentityCancellationTrigger,
  dependencies: IdentityCancellationDependencies,
): Promise<void> {
  const eve = dependencies.eve ?? createEveGateway();
  const repository =
    dependencies.repository ?? createConversationRepository();
  const recordAudit = dependencies.recordAudit ?? recordIdentityCancellation;
  const monitor = dependencies.monitor ?? monitorIdentityCancellation;
  await Promise.all(
    pending.settled.map((settled) =>
      recordAudit(actor, settled, trigger, "SUCCESS").catch(
        (error) => logCancellationFailure(settled.conversationId, trigger, error),
      ),
    ),
  );
  await Promise.all(
    pending.reservations.map(async (reservation) => {
      try {
        const status = await eve.cancelTurn({
          identity: serviceIdentity(
            {
              userId: reservation.ownerUserId,
              tenantId: reservation.tenantId,
              role: reservation.role,
              source: reservation.ownerSource,
            },
            reservation,
          ),
          sessionId: reservation.eveSessionId,
          eveTurnId: reservation.eveTurnId ?? undefined,
        });
        if (status === "no_active_turn") {
          await repository.settleUnresolvedCancellation(reservation);
        } else {
          void monitor(reservation, eve).catch((error) => {
            console.error(
              JSON.stringify({
                level: "error",
                event: "identity_change_reply_monitor_failed",
                conversationId: reservation.conversationId,
                ...operationalErrorMetadata(error),
              }),
            );
          });
        }
      } catch (error) {
        await recordAudit(
          actor,
          reservation,
          trigger,
          "FAILURE",
        ).catch((auditError) =>
          logCancellationFailure(
            reservation.conversationId,
            trigger,
            auditError,
            "identity_change_reply_cancellation_audit_failed",
          ),
        );
        logCancellationFailure(reservation.conversationId, trigger, error);
        return;
      }
      await recordAudit(
        actor,
        reservation,
        trigger,
        "SUCCESS",
      ).catch((error) =>
        logCancellationFailure(
          reservation.conversationId,
          trigger,
          error,
          "identity_change_reply_cancellation_audit_failed",
        ),
      );
    }),
  );
}

async function monitorIdentityCancellation(
  reservation: IdentityCancellationReservation,
  eve: EveGateway,
): Promise<void> {
  const signal = AbortSignal.timeout(60_000);
  const events = eve.streamSession({
    identity: serviceIdentity(
      {
        userId: reservation.ownerUserId,
        tenantId: reservation.tenantId,
        role: reservation.role,
        source: reservation.ownerSource,
      },
      reservation,
    ),
    sessionId: reservation.eveSessionId,
    startIndex: reservation.nextStreamIndex,
    follow: true,
    signal,
  });
  await monitorEveEvents({
    conversationId: reservation.conversationId,
    startIndex: reservation.nextStreamIndex,
    events: throughSessionSettlement(events),
    eve,
  });
}

async function* throughSessionSettlement(
  events: AsyncIterable<import("eve/client").HandleMessageStreamEvent>,
) {
  for await (const event of events) {
    yield event;
    if (
      event.type === "session.waiting" ||
      event.type === "session.failed" ||
      event.type === "session.completed"
    ) {
      return;
    }
  }
}

async function recordIdentityCancellation(
  actor: AdminPrincipal,
  reservation: SettledIdentityCancellation,
  trigger: IdentityCancellationTrigger,
  outcome: "SUCCESS" | "FAILURE",
): Promise<void> {
  await writeSecurityAudit(getDatabase(), {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorSource: "LOCAL",
    action: "IDENTITY_CHANGE_ACTIVE_REPLY_CANCELLED",
    targetType: "CONVERSATION",
    targetId: reservation.conversationId,
    outcome,
    metadata: { trigger, ownerUserId: reservation.ownerUserId },
  });
}

function logCancellationFailure(
  conversationId: string,
  trigger: IdentityCancellationTrigger,
  error: unknown,
  event = "identity_change_reply_cancellation_failed",
): void {
  console.error(
    JSON.stringify({
      level: "error",
      event,
      conversationId,
      trigger,
      ...operationalErrorMetadata(error),
    }),
  );
}
