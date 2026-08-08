import "server-only";

import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import { createEveGateway, EveGatewayRejectedError } from "@/src/server/eve/client";
import { buildEveUserContent } from "@/src/server/eve/user-content";
import { decryptContinuationToken } from "@/src/server/models/credentials";
import { conversationUnavailable, eveRequestRejected } from "./errors";
import { monitorEveEvents } from "./lifecycle";
import {
  createConversationRepository,
  type ConversationContinuationRepository,
} from "./repository";
import { serviceIdentity } from "./creation";
import type { ConversationSubmission, EveGateway } from "./types";

export async function continueConversation(
  principal: AuthenticatedPrincipal,
  conversationId: string,
  input: {
    readonly message: string;
    readonly requestId: string;
    readonly attachmentIds?: readonly string[];
    readonly retryOfTurnId?: string;
  },
  dependencies: {
    readonly repository?: ConversationContinuationRepository;
    readonly eve?: EveGateway;
    readonly decryptToken?: typeof decryptContinuationToken;
  } = {},
): Promise<ConversationSubmission> {
  const repository = dependencies.repository ?? createConversationRepository();
  const eve = dependencies.eve ?? createEveGateway();
  const decryptToken = dependencies.decryptToken ?? decryptContinuationToken;
  const reservation = await repository.reserveContinuation(
    principal,
    conversationId,
    input,
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

  const reserved = reservation.value;
  if (!reserved.eveSessionId || !reserved.encryptedContinuationToken) {
    throw conversationUnavailable();
  }
  let continuationToken: string;
  try {
    continuationToken = await decryptToken(reserved.encryptedContinuationToken, {
      tenantId: reserved.tenantId,
      conversationId: reserved.conversationId,
      revision: reserved.continuationTokenRevision,
    });
  } catch {
    await repository.rejectSubmission(reserved);
    throw conversationUnavailable();
  }

  let message;
  try {
    message = await buildEveUserContent(
      reservation.message,
      reservation.attachments ?? [],
    );
  } catch (error) {
    await repository.rejectSubmission(reserved);
    throw error;
  }

  let accepted;
  try {
    accepted = await eve.continueTurn({
      identity: serviceIdentity(principal, reserved),
      sessionId: reserved.eveSessionId,
      continuationToken,
      streamIndex: reserved.nextStreamIndex,
      message,
    });
  } catch (error) {
    if (error instanceof EveGatewayRejectedError) {
      await repository.rejectSubmission(reserved);
      throw eveRequestRejected(error);
    }
    throw error;
  }
  await repository.acceptContinuation(reserved, accepted.sessionId);

  return {
    conversation: await repository.getOwnedConversation(
      principal,
      reserved.conversationId,
    ),
    turn: { id: reserved.turnId, status: "RUNNING" },
    duplicate: false,
    monitor: () =>
      monitorEveEvents({
        conversationId: reserved.conversationId,
        startIndex: reserved.nextStreamIndex,
        events: accepted.events,
        repository,
        eve,
      }),
  };
}
