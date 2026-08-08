import "server-only";

import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import { EveGatewayRejectedError, createEveGateway } from "@/src/server/eve/client";
import { buildEveUserContent } from "@/src/server/eve/user-content";
import { encryptContinuationToken } from "@/src/server/models/credentials";
import { eveRequestRejected } from "./errors";
import { monitorEveEvents } from "./lifecycle";
import {
  createConversationRepository,
  type ConversationCreationRepository,
} from "./repository";
import { serviceIdentity } from "./service-identity";
import type {
  ConversationSubmission,
  EveGateway,
} from "./types";

export async function createConversation(
  principal: AuthenticatedPrincipal,
  input: {
    readonly message: string;
    readonly requestId: string;
    readonly attachmentIds?: readonly string[];
  },
  dependencies: {
    readonly repository?: ConversationCreationRepository;
    readonly eve?: EveGateway;
    readonly encryptToken?: typeof encryptContinuationToken;
  } = {},
): Promise<ConversationSubmission> {
  const repository = dependencies.repository ?? createConversationRepository();
  const eve = dependencies.eve ?? createEveGateway();
  const encryptToken = dependencies.encryptToken ?? encryptContinuationToken;
  const reservation = await repository.reserveCreation(principal, input);
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
  let message;
  try {
    message = await buildEveUserContent(
      reservation.message,
      reservation.attachments ?? [],
    );
  } catch (error) {
    await repository.rejectSubmission(reservation.value);
    throw error;
  }
  let accepted;
  try {
    accepted = await eve.startTurn({
      identity,
      message,
    });
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
        eve,
      }),
  };
}

export { serviceIdentity } from "./service-identity";
