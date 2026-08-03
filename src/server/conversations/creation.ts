import "server-only";

import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import { EveGatewayRejectedError, createEveGateway } from "@/src/server/eve/client";
import { encryptContinuationToken } from "@/src/server/models/credentials";
import { eveRequestRejected } from "./errors";
import { monitorEveEvents } from "./lifecycle";
import {
  createConversationRepository,
  type ConversationCreationRepository,
} from "./repository";
import type {
  ConversationSubmission,
  EveGateway,
  EveServiceIdentity,
} from "./types";

export async function createConversation(
  principal: AuthenticatedPrincipal,
  input: { readonly message: string; readonly requestId: string },
  dependencies: {
    readonly repository?: ConversationCreationRepository;
    readonly eve?: EveGateway;
    readonly encryptToken?: typeof encryptContinuationToken;
  } = {},
): Promise<ConversationSubmission> {
  const repository = dependencies.repository ?? createConversationRepository();
  const eve = dependencies.eve ?? createEveGateway();
  const encryptToken = dependencies.encryptToken ?? encryptContinuationToken;
  const reservation = await repository.reserveCreation(
    principal,
    input.requestId,
  );
  if (reservation.kind === "duplicate") {
    return {
      conversation: await repository.getOwnedConversation(
        principal,
        reservation.value.conversationId,
      ),
      turn: {
        id: reservation.value.turnId,
        status: reservation.value.turnStatus,
      },
      duplicate: true,
      monitor: null,
    };
  }

  const identity = serviceIdentity(principal, reservation.value);
  let accepted;
  try {
    accepted = await eve.startTurn({ identity, message: input.message });
  } catch (error) {
    if (error instanceof EveGatewayRejectedError) {
      await repository.rejectSubmission(reservation.value);
      throw eveRequestRejected(error);
    }
    throw error;
  }
  await repository.recordCreationSession(
    reservation.value,
    accepted.sessionId,
  );
  const revision = accepted.continuationToken ? 1 : 0;
  const encryptedContinuationToken = accepted.continuationToken
    ? await encryptToken(accepted.continuationToken, {
        tenantId: reservation.value.tenantId,
        conversationId: reservation.value.conversationId,
        revision,
      })
    : null;
  await repository.acceptCreation(reservation.value, {
    eveSessionId: accepted.sessionId,
    encryptedContinuationToken,
    continuationTokenRevision: revision,
  });

  return {
    conversation: await repository.getOwnedConversation(
      principal,
      reservation.value.conversationId,
    ),
    turn: { id: reservation.value.turnId, status: "RUNNING" },
    duplicate: false,
    monitor: () =>
      monitorEveEvents({
        conversationId: reservation.value.conversationId,
        startIndex: 0,
        events: accepted.events,
        repository,
      }),
  };
}

export function serviceIdentity(
  principal: Pick<
    AuthenticatedPrincipal,
    "userId" | "tenantId" | "role" | "source"
  >,
  turn: {
    readonly conversationId: string;
    readonly turnId: string;
    readonly modelConfigVersionId: string;
  },
): EveServiceIdentity {
  return {
    userId: principal.userId,
    tenantId: principal.tenantId,
    role: principal.role,
    source: principal.source,
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    modelConfigVersionId: turn.modelConfigVersionId,
  };
}
