import "server-only";

import { randomUUID } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  lt,
} from "drizzle-orm";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import {
  isAdminPrincipal,
  type AuthenticatedPrincipal,
} from "@/src/server/auth/principal";
import { getDatabase, type Database } from "@/src/server/db/client";
import {
  conversationTurns,
  conversations,
  userProfiles,
} from "@/src/server/db/schema";
import { lockCurrentModelConfigurationVersion } from "@/src/server/models/configuration";
import {
  conversationAuthenticationExpired,
  conversationBusy,
  conversationNotFound,
  conversationPersistenceFailure,
  conversationUnavailable,
  turnChanged,
  userConcurrencyLimit,
} from "./errors";
import { createConversationEventPersistence } from "./event-persistence";
import type { ConversationTransaction } from "./repository-types";
import {
  MAIN_AGENT_ID,
  MAX_ACTIVE_TURNS_PER_USER,
  type CancellationReservation,
  type PublicConversation,
  type ReservedConversationTurn,
  type RuntimeConversation,
  type TurnReservation,
} from "./types";

const ACTIVE_TURN_STATUSES = ["SUBMITTING", "RUNNING", "CANCELLING"] as const;
const BUSY_CONVERSATION_STATUSES = [
  "STARTING",
  "RUNNING",
  "CANCELLING",
] as const;
const TERMINAL_CONVERSATION_STATUSES = [
  "TERMINAL_FAILED",
  "TERMINAL_COMPLETED",
] as const;
const UNCONFIRMED_SUBMISSION_EXPIRY_MS = 5 * 60 * 1_000;

export type ProjectionTurn = {
  readonly turnId: string;
  readonly publicErrorCode: string | null;
};

export type ConversationRepository = ReturnType<
  typeof createConversationRepository
>;

export type ConversationEventRepository = Pick<
  ConversationRepository,
  "applyEvent" | "getRuntimeConversationById"
>;

export type ConversationLifecycleRepository = ConversationEventRepository;

export type ConversationCreationRepository = ConversationEventRepository &
  Pick<
    ConversationRepository,
    | "acceptCreation"
    | "getOwnedConversation"
    | "recordCreationSession"
    | "rejectSubmission"
    | "reserveCreation"
  >;

export type ConversationContinuationRepository =
  ConversationEventRepository &
    Pick<
      ConversationRepository,
      | "acceptContinuation"
      | "getOwnedConversation"
      | "rejectSubmission"
      | "reserveContinuation"
    >;

export type ConversationReconciliationRepository =
  ConversationEventRepository &
    Pick<
      ConversationRepository,
      "expireUnconfirmedSubmission" | "listPendingConversationIds"
    >;

export type ConversationCancellationRepository =
  ConversationReconciliationRepository &
    Pick<
      ConversationRepository,
      | "recordAdminCancellation"
      | "reserveCancellation"
      | "restoreCancellation"
      | "settleUnresolvedCancellation"
    >;

export type ConversationQueryRepository = Pick<
  ConversationRepository,
  "getOwnedConversation"
>;

export type ConversationStreamRepository = ConversationEventRepository &
  Pick<
    ConversationRepository,
    "findProjectionTurn" | "getRuntimeConversation"
  >;

export function createConversationRepository(
  database: Database = getDatabase(),
) {
  const eventPersistence = createConversationEventPersistence(database);
  return {
    applyEvent: eventPersistence.applyEvent,

    reserveCreation(
      principal: AuthenticatedPrincipal,
      requestId: string,
    ): Promise<TurnReservation> {
      return database.transaction(async (transaction) => {
        await lockCurrentPrincipal(transaction, principal);
        const duplicate = await findRequestTurn(
          transaction,
          principal,
          requestId,
        );
        if (duplicate) return { kind: "duplicate", value: duplicate };

        await assertUserConcurrency(transaction, principal);
        const model = await lockCurrentModelConfigurationVersion(
          transaction,
          principal.tenantId,
        );
        const conversationId = randomUUID();
        const turnId = randomUUID();
        const now = new Date();
        await transaction.insert(conversations).values({
          id: conversationId,
          tenantId: principal.tenantId,
          ownerUserId: principal.userId,
          ownerSource: principal.source,
          agentId: MAIN_AGENT_ID,
          status: "STARTING",
          activeTurnId: turnId,
          createdAt: now,
          updatedAt: now,
        });
        await transaction.insert(conversationTurns).values({
          id: turnId,
          tenantId: principal.tenantId,
          conversationId,
          ownerUserId: principal.userId,
          requestId,
          modelConfigVersionId: model.id,
          status: "SUBMITTING",
          createdAt: now,
          updatedAt: now,
        });
        return {
          kind: "reserved",
          value: {
            conversationId,
            turnId,
            tenantId: principal.tenantId,
            ownerUserId: principal.userId,
            ownerSource: principal.source,
            modelConfigVersionId: model.id,
            eveTurnId: null,
            conversationStatus: "STARTING",
            turnStatus: "SUBMITTING",
            eveSessionId: null,
            encryptedContinuationToken: null,
            continuationTokenRevision: 0,
            nextStreamIndex: 0,
            createdAt: now,
            updatedAt: now,
          },
        };
      });
    },

    reserveContinuation(
      principal: AuthenticatedPrincipal,
      conversationId: string,
      requestId: string,
    ): Promise<TurnReservation> {
      return database.transaction(async (transaction) => {
        await lockCurrentPrincipal(transaction, principal);
        const duplicate = await findRequestTurn(
          transaction,
          principal,
          requestId,
        );
        if (duplicate) return { kind: "duplicate", value: duplicate };

        const conversation = await findOwnedConversation(
          transaction,
          principal,
          conversationId,
          true,
        );
        if (!conversation) throw conversationNotFound();
        if (
          BUSY_CONVERSATION_STATUSES.some(
            (status) => status === conversation.status,
          )
        ) {
          throw conversationBusy();
        }
        if (
          TERMINAL_CONVERSATION_STATUSES.some(
            (status) => status === conversation.status,
          ) ||
          conversation.status !== "WAITING" ||
          !conversation.eveSessionId ||
          !conversation.encryptedContinuationToken
        ) {
          throw conversationUnavailable();
        }

        await assertUserConcurrency(transaction, principal);
        const model = await lockCurrentModelConfigurationVersion(
          transaction,
          principal.tenantId,
        );
        const turnId = randomUUID();
        const now = new Date();
        await transaction.insert(conversationTurns).values({
          id: turnId,
          tenantId: principal.tenantId,
          conversationId,
          ownerUserId: principal.userId,
          requestId,
          modelConfigVersionId: model.id,
          status: "SUBMITTING",
          createdAt: now,
          updatedAt: now,
        });
        const [updated] = await transaction
          .update(conversations)
          .set({ status: "RUNNING", activeTurnId: turnId, updatedAt: now })
          .where(
            and(
              eq(conversations.id, conversationId),
              eq(conversations.tenantId, principal.tenantId),
              eq(conversations.status, "WAITING"),
            ),
          )
          .returning({ id: conversations.id });
        if (!updated) throw conversationBusy();

        return {
          kind: "reserved",
          value: {
            conversationId,
            turnId,
            tenantId: principal.tenantId,
            ownerUserId: principal.userId,
            ownerSource: conversation.ownerSource,
            modelConfigVersionId: model.id,
            eveTurnId: null,
            conversationStatus: "RUNNING",
            turnStatus: "SUBMITTING",
            eveSessionId: conversation.eveSessionId,
            encryptedContinuationToken:
              conversation.encryptedContinuationToken,
            continuationTokenRevision:
              conversation.continuationTokenRevision,
            nextStreamIndex: nextStreamIndex(conversation.lastEveCursor),
            createdAt: conversation.createdAt,
            updatedAt: now,
          },
        };
      });
    },

    async recordCreationSession(
      reservation: ReservedConversationTurn,
      eveSessionId: string,
    ): Promise<void> {
      const [updated] = await database
        .update(conversations)
        .set({ eveSessionId, updatedAt: new Date() })
        .where(
          and(
            eq(conversations.id, reservation.conversationId),
            eq(conversations.tenantId, reservation.tenantId),
            eq(conversations.activeTurnId, reservation.turnId),
            eq(conversations.status, "STARTING"),
          ),
        )
        .returning({ id: conversations.id });
      if (!updated) throw conversationPersistenceFailure();
    },

    async acceptCreation(
      reservation: ReservedConversationTurn,
      input: {
        readonly eveSessionId: string;
        readonly encryptedContinuationToken: string | null;
        readonly continuationTokenRevision: number;
      },
    ): Promise<void> {
      const now = new Date();
      await database.transaction(async (transaction) => {
        const [updated] = await transaction
          .update(conversations)
          .set({
            eveSessionId: input.eveSessionId,
            encryptedContinuationToken: input.encryptedContinuationToken,
            continuationTokenRevision: input.continuationTokenRevision,
            status: "RUNNING",
            updatedAt: now,
          })
          .where(
            and(
              eq(conversations.id, reservation.conversationId),
              eq(conversations.tenantId, reservation.tenantId),
              eq(conversations.activeTurnId, reservation.turnId),
              eq(conversations.status, "STARTING"),
            ),
          )
          .returning({ id: conversations.id });
        if (!updated) throw conversationPersistenceFailure();
        const [updatedTurn] = await transaction
          .update(conversationTurns)
          .set({ status: "RUNNING", startedAt: now, updatedAt: now })
          .where(
            and(
              eq(conversationTurns.id, reservation.turnId),
              eq(conversationTurns.status, "SUBMITTING"),
            ),
          )
          .returning({ id: conversationTurns.id });
        if (!updatedTurn) throw conversationPersistenceFailure();
      });
    },

    async acceptContinuation(
      reservation: ReservedConversationTurn,
      eveSessionId: string,
    ): Promise<void> {
      if (reservation.eveSessionId !== eveSessionId) {
        throw conversationPersistenceFailure();
      }
      const now = new Date();
      const [updated] = await database
        .update(conversationTurns)
        .set({ status: "RUNNING", startedAt: now, updatedAt: now })
        .where(
          and(
            eq(conversationTurns.id, reservation.turnId),
            eq(conversationTurns.status, "SUBMITTING"),
          ),
        )
        .returning({ id: conversationTurns.id });
      if (!updated) throw conversationPersistenceFailure();
    },

    rejectSubmission(reservation: ReservedConversationTurn): Promise<void> {
      const now = new Date();
      return database.transaction(async (transaction) => {
        await transaction
          .update(conversationTurns)
          .set({
            status: "FAILED",
            publicErrorCode: "REQUEST_FAILED",
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(conversationTurns.id, reservation.turnId),
              eq(conversationTurns.status, "SUBMITTING"),
            ),
          );
        await transaction
          .update(conversations)
          .set({
            status: reservation.eveSessionId
              ? "WAITING"
              : "TERMINAL_FAILED",
            activeTurnId: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(conversations.id, reservation.conversationId),
              eq(conversations.activeTurnId, reservation.turnId),
            ),
          );
      });
    },

    reserveCancellation(
      principal: AuthenticatedPrincipal,
      conversationId: string,
      observedTurnId: string,
    ): Promise<CancellationReservation> {
      return database.transaction(async (transaction) => {
        await lockCurrentPrincipal(transaction, principal);
        const conversation = await findTenantConversation(
          transaction,
          principal.tenantId,
          conversationId,
          true,
        );
        if (
          !conversation ||
          ((conversation.ownerUserId !== principal.userId ||
            conversation.ownerSource !== principal.source) &&
            !isAdminPrincipal(principal))
        ) {
          throw conversationNotFound();
        }
        if (!conversation.activeTurnId) return { kind: "no_active_turn" };
        if (conversation.activeTurnId !== observedTurnId) throw turnChanged();
        if (!conversation.eveSessionId) throw conversationUnavailable();

        const turn = await findTurnById(
          transaction,
          conversation.tenantId,
          conversation.activeTurnId,
        );
        if (!turn) throw conversationPersistenceFailure();
        if (
          !ACTIVE_TURN_STATUSES.some((status) => status === turn.status)
        ) {
          return { kind: "no_active_turn" };
        }
        const now = new Date();
        await transaction
          .update(conversations)
          .set({ status: "CANCELLING", updatedAt: now })
          .where(eq(conversations.id, conversation.id));
        await transaction
          .update(conversationTurns)
          .set({ status: "CANCELLING", updatedAt: now })
          .where(eq(conversationTurns.id, turn.id));

        return {
          kind: "reserved",
          value: {
            ...toReserved(conversation, turn),
            eveSessionId: conversation.eveSessionId,
            conversationStatus: "CANCELLING",
            turnStatus: "CANCELLING",
          },
          administeredForAnotherUser:
            conversation.ownerUserId !== principal.userId ||
            conversation.ownerSource !== principal.source,
        };
      });
    },

    restoreCancellation(reservation: ReservedConversationTurn): Promise<void> {
      const now = new Date();
      return database.transaction(async (transaction) => {
        await transaction
          .update(conversations)
          .set({ status: "RUNNING", updatedAt: now })
          .where(
            and(
              eq(conversations.id, reservation.conversationId),
              eq(conversations.activeTurnId, reservation.turnId),
              eq(conversations.status, "CANCELLING"),
            ),
          );
        await transaction
          .update(conversationTurns)
          .set({ status: "RUNNING", updatedAt: now })
          .where(
            and(
              eq(conversationTurns.id, reservation.turnId),
              eq(conversationTurns.status, "CANCELLING"),
            ),
          );
      });
    },

    settleUnresolvedCancellation(
      reservation: ReservedConversationTurn,
    ): Promise<void> {
      return database.transaction(async (transaction) => {
        const [conversation] = await transaction
          .select({
            activeTurnId: conversations.activeTurnId,
            status: conversations.status,
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.id, reservation.conversationId),
              eq(conversations.tenantId, reservation.tenantId),
            ),
          )
          .limit(1)
          .for("update");
        if (
          conversation?.status !== "CANCELLING" ||
          conversation.activeTurnId !== reservation.turnId
        ) {
          return;
        }

        const now = new Date();
        await transaction
          .update(conversationTurns)
          .set({
            status: "FAILED",
            publicErrorCode: "CONVERSATION_UNAVAILABLE",
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(conversationTurns.id, reservation.turnId),
              eq(conversationTurns.status, "CANCELLING"),
            ),
          );
        await transaction
          .update(conversations)
          .set({ status: "WAITING", activeTurnId: null, updatedAt: now })
          .where(eq(conversations.id, reservation.conversationId));
      });
    },

    async recordAdminCancellation(
      principal: AuthenticatedPrincipal,
      reservation: ReservedConversationTurn,
      outcome: "SUCCESS" | "FAILURE",
    ): Promise<void> {
      await writeSecurityAudit(database, {
        tenantId: principal.tenantId,
        actorUserId: principal.userId,
        actorSource: "LOCAL",
        action: "CONVERSATION_CANCELLED_BY_ADMIN",
        targetType: "CONVERSATION",
        targetId: reservation.conversationId,
        outcome,
        metadata: { ownerUserId: reservation.ownerUserId },
      });
    },

    getOwnedConversation(
      principal: AuthenticatedPrincipal,
      conversationId: string,
    ): Promise<PublicConversation> {
      return getOwnedPublicConversation(database, principal, conversationId);
    },

    async getRuntimeConversation(
      principal: AuthenticatedPrincipal,
      conversationId: string,
    ): Promise<RuntimeConversation> {
      const conversation = await findOwnedConversation(
        database,
        principal,
        conversationId,
      );
      if (!conversation) throw conversationNotFound();
      const turn = await findRuntimeTurn(database, conversation);
      if (!turn) throw conversationUnavailable();
      return { ...toReserved(conversation, turn), role: principal.role };
    },

    async getRuntimeConversationById(
      conversationId: string,
    ): Promise<RuntimeConversation | null> {
      const [conversation] = await database
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
      if (!conversation) return null;
      const [profile] = await database
        .select({ role: userProfiles.role })
        .from(userProfiles)
        .where(
          and(
            eq(userProfiles.userId, conversation.ownerUserId),
            eq(userProfiles.tenantId, conversation.tenantId),
            eq(userProfiles.source, conversation.ownerSource),
          ),
        )
        .limit(1);
      const turn = await findRuntimeTurn(database, conversation);
      if (!profile || !turn) return null;
      return { ...toReserved(conversation, turn), role: profile.role };
    },

    async findProjectionTurn(
      conversationId: string,
      eveTurnId: string,
    ): Promise<ProjectionTurn | null> {
      const [turn] = await database
        .select({
          turnId: conversationTurns.id,
          publicErrorCode: conversationTurns.publicErrorCode,
        })
        .from(conversationTurns)
        .where(
          and(
            eq(conversationTurns.conversationId, conversationId),
            eq(conversationTurns.eveTurnId, eveTurnId),
          ),
        )
        .limit(1);
      return turn ?? null;
    },

    async listPendingConversationIds(limit: number): Promise<string[]> {
      const rows = await database
        .select({ id: conversations.id })
        .from(conversations)
        .where(inArray(conversations.status, BUSY_CONVERSATION_STATUSES))
        .orderBy(conversations.updatedAt)
        .limit(limit);
      return rows.map(({ id }) => id);
    },

    expireUnconfirmedSubmission(
      conversationId: string,
      updatedBefore = new Date(Date.now() - UNCONFIRMED_SUBMISSION_EXPIRY_MS),
    ): Promise<boolean> {
      return database.transaction(async (transaction) => {
        const [row] = await transaction
          .select({ conversation: conversations, turn: conversationTurns })
          .from(conversations)
          .innerJoin(
            conversationTurns,
            eq(conversationTurns.id, conversations.activeTurnId),
          )
          .where(
            and(
              eq(conversations.id, conversationId),
              lt(conversations.updatedAt, updatedBefore),
            ),
          )
          .limit(1)
          .for("update");
        if (!row || row.turn.status !== "SUBMITTING") return false;

        const now = new Date();
        await transaction
          .update(conversationTurns)
          .set({
            status: "FAILED",
            publicErrorCode: "REQUEST_FAILED",
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(conversationTurns.id, row.turn.id),
              eq(conversationTurns.status, "SUBMITTING"),
            ),
          );
        await transaction
          .update(conversations)
          .set({
            status:
              row.conversation.status === "STARTING"
                ? "TERMINAL_FAILED"
                : "WAITING",
            activeTurnId: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(conversations.id, conversationId),
              eq(conversations.activeTurnId, row.turn.id),
            ),
          );
        return true;
      });
    },
  };
}

async function lockCurrentPrincipal(
  transaction: ConversationTransaction,
  principal: AuthenticatedPrincipal,
): Promise<void> {
  const [profile] = await transaction
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, principal.userId))
    .limit(1)
    .for("update");
  if (
    !profile ||
    profile.status !== "ACTIVE" ||
    profile.tenantId !== principal.tenantId ||
    profile.role !== principal.role ||
    profile.source !== principal.source
  ) {
    throw conversationAuthenticationExpired();
  }
}

async function assertUserConcurrency(
  transaction: ConversationTransaction,
  principal: AuthenticatedPrincipal,
): Promise<void> {
  const [active] = await transaction
    .select({ value: count() })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.tenantId, principal.tenantId),
        eq(conversationTurns.ownerUserId, principal.userId),
        inArray(conversationTurns.status, ACTIVE_TURN_STATUSES),
      ),
    );
  if ((active?.value ?? 0) >= MAX_ACTIVE_TURNS_PER_USER) {
    throw userConcurrencyLimit();
  }
}

async function findRequestTurn(
  database: Pick<Database, "select"> | ConversationTransaction,
  principal: AuthenticatedPrincipal,
  requestId: string,
): Promise<ReservedConversationTurn | null> {
  const [row] = await database
    .select({ conversation: conversations, turn: conversationTurns })
    .from(conversationTurns)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, conversationTurns.conversationId),
        eq(conversations.tenantId, conversationTurns.tenantId),
      ),
    )
    .where(
      and(
        eq(conversationTurns.tenantId, principal.tenantId),
        eq(conversationTurns.ownerUserId, principal.userId),
        eq(conversationTurns.requestId, requestId),
        eq(conversations.ownerSource, principal.source),
      ),
    )
    .limit(1);
  return row ? toReserved(row.conversation, row.turn) : null;
}

async function findOwnedConversation(
  database: Pick<Database, "select"> | ConversationTransaction,
  principal: AuthenticatedPrincipal,
  conversationId: string,
  lock = false,
) {
  const query = database
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.tenantId, principal.tenantId),
        eq(conversations.ownerUserId, principal.userId),
        eq(conversations.ownerSource, principal.source),
      ),
    )
    .limit(1);
  const rows = lock && "for" in query ? await query.for("update") : await query;
  return rows[0];
}

async function findTenantConversation(
  database: Pick<Database, "select"> | ConversationTransaction,
  tenantId: string,
  conversationId: string,
  lock = false,
) {
  const query = database
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.tenantId, tenantId),
      ),
    )
    .limit(1);
  const rows = lock && "for" in query ? await query.for("update") : await query;
  return rows[0];
}

async function findTurnById(
  database: Pick<Database, "select"> | ConversationTransaction,
  tenantId: string,
  turnId: string,
) {
  const [turn] = await database
    .select()
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.id, turnId),
        eq(conversationTurns.tenantId, tenantId),
      ),
    )
    .limit(1);
  return turn;
}

async function findRuntimeTurn(
  database: Pick<Database, "select">,
  conversation: typeof conversations.$inferSelect,
) {
  if (conversation.activeTurnId) {
    return findTurnById(database, conversation.tenantId, conversation.activeTurnId);
  }
  const [turn] = await database
    .select()
    .from(conversationTurns)
    .where(eq(conversationTurns.conversationId, conversation.id))
    .orderBy(desc(conversationTurns.createdAt))
    .limit(1);
  return turn;
}

async function getOwnedPublicConversation(
  database: Database,
  principal: AuthenticatedPrincipal,
  conversationId: string,
): Promise<PublicConversation> {
  const conversation = await findOwnedConversation(
    database,
    principal,
    conversationId,
  );
  if (!conversation) throw conversationNotFound();
  const activeTurn = conversation.activeTurnId
    ? await findTurnById(
        database,
        conversation.tenantId,
        conversation.activeTurnId,
      )
    : null;
  return {
    id: conversation.id,
    status: conversation.status,
    activeTurn: activeTurn
      ? { id: activeTurn.id, status: activeTurn.status }
      : null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

function toReserved(
  conversation: typeof conversations.$inferSelect,
  turn: typeof conversationTurns.$inferSelect,
): ReservedConversationTurn {
  return {
    conversationId: conversation.id,
    turnId: turn.id,
    tenantId: conversation.tenantId,
    ownerUserId: conversation.ownerUserId,
    ownerSource: conversation.ownerSource,
    modelConfigVersionId: turn.modelConfigVersionId,
    eveTurnId: turn.eveTurnId,
    conversationStatus: conversation.status,
    turnStatus: turn.status,
    eveSessionId: conversation.eveSessionId,
    encryptedContinuationToken: conversation.encryptedContinuationToken,
    continuationTokenRevision: conversation.continuationTokenRevision,
    nextStreamIndex: nextStreamIndex(conversation.lastEveCursor),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function nextStreamIndex(lastCursor: bigint | null): number {
  if (lastCursor === null) return 0;
  if (lastCursor >= BigInt(Number.MAX_SAFE_INTEGER)) {
    throw conversationPersistenceFailure();
  }
  return Number(lastCursor) + 1;
}
