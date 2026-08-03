import "server-only";

import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import { createEveGateway } from "@/src/server/eve/client";
import {
  createConversationRepository,
  type ConversationCancellationRepository,
} from "./repository";
import { reconcileConversation } from "./reconciliation";
import { serviceIdentity } from "./creation";
import type { EveGateway } from "./types";

export async function cancelConversationTurn(
  principal: AuthenticatedPrincipal,
  conversationId: string,
  observedTurnId: string,
  dependencies: {
    readonly repository?: ConversationCancellationRepository;
    readonly eve?: EveGateway;
    readonly reconcile?: typeof reconcileConversation;
  } = {},
): Promise<{ readonly status: "accepted" | "no_active_turn" }> {
  const repository = dependencies.repository ?? createConversationRepository();
  const eve = dependencies.eve ?? createEveGateway();
  const reservation = await repository.reserveCancellation(
    principal,
    conversationId,
    observedTurnId,
  );
  if (reservation.kind === "no_active_turn") {
    return { status: "no_active_turn" };
  }

  let status: "accepted" | "no_active_turn";
  try {
    status = await eve.cancelTurn({
      identity: serviceIdentity(principal, reservation.value),
      sessionId: reservation.value.eveSessionId,
      eveTurnId: reservation.value.eveTurnId ?? undefined,
    });
  } catch (error) {
    await repository.restoreCancellation(reservation.value);
    if (reservation.administeredForAnotherUser) {
      await repository.recordAdminCancellation(
        principal,
        reservation.value,
        "FAILURE",
      );
    }
    throw error;
  }

  if (status === "no_active_turn") {
    await (dependencies.reconcile ?? reconcileConversation)(conversationId, {
      repository,
      eve,
    });
    await repository.settleUnresolvedCancellation(reservation.value);
  }

  if (reservation.administeredForAnotherUser) {
    await repository.recordAdminCancellation(
      principal,
      reservation.value,
      "SUCCESS",
    );
  }
  return { status };
}
