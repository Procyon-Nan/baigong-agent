import "server-only";

import { createEveGateway } from "@/src/server/eve/client";
import { monitorEveEvents } from "./lifecycle";
import {
  createConversationRepository,
  type ConversationReconciliationRepository,
} from "./repository";
import { serviceIdentity } from "./creation";
import type { EveGateway } from "./types";

export type ReconciliationResult =
  | "reconciled"
  | "submission_expired"
  | "mapping_pending"
  | "conversation_missing";

export async function reconcileConversation(
  conversationId: string,
  dependencies: {
    readonly repository?: ConversationReconciliationRepository;
    readonly eve?: EveGateway;
    readonly expireUnconfirmedSubmission?: boolean;
  } = {},
): Promise<ReconciliationResult> {
  const repository = dependencies.repository ?? createConversationRepository();
  const eve = dependencies.eve ?? createEveGateway();
  const runtime = await repository.getRuntimeConversationById(conversationId);
  if (!runtime) return "conversation_missing";
  if (!runtime.eveSessionId) {
    return dependencies.expireUnconfirmedSubmission &&
      (await repository.expireUnconfirmedSubmission(conversationId))
      ? "submission_expired"
      : "mapping_pending";
  }
  const startIndex = await repository.getReconciliationStartIndex(
    conversationId,
  );

  await monitorEveEvents({
    conversationId,
    startIndex,
    events: eve.streamSession({
      identity: serviceIdentity(
        {
          userId: runtime.ownerUserId,
          tenantId: runtime.tenantId,
          role: runtime.role,
          source: runtime.ownerSource,
        },
        runtime,
      ),
      sessionId: runtime.eveSessionId,
      startIndex,
      follow: false,
    }),
    repository,
    eve,
  });
  if (
    dependencies.expireUnconfirmedSubmission &&
    (await repository.expireUnconfirmedSubmission(conversationId))
  ) {
    return "submission_expired";
  }
  return "reconciled";
}

export async function reconcilePendingConversations(
  dependencies: {
    readonly repository?: ConversationReconciliationRepository;
    readonly eve?: EveGateway;
    readonly limit?: number;
    readonly expireUnconfirmedSubmissions?: boolean;
  } = {},
): Promise<Readonly<Record<ReconciliationResult, number>>> {
  const repository = dependencies.repository ?? createConversationRepository();
  const ids = await repository.listPendingConversationIds(
    dependencies.limit ?? 50,
  );
  const counts: Record<ReconciliationResult, number> = {
    reconciled: 0,
    submission_expired: 0,
    mapping_pending: 0,
    conversation_missing: 0,
  };
  for (const conversationId of ids) {
    const result = await reconcileConversation(conversationId, {
      repository,
      eve: dependencies.eve,
      expireUnconfirmedSubmission:
        dependencies.expireUnconfirmedSubmissions,
    });
    counts[result] += 1;
  }
  return counts;
}
