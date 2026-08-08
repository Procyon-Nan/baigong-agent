import "server-only";

import type { HandleMessageStreamEvent } from "eve/client";
import { operationalErrorMetadata } from "@/src/server/errors";
import { purgeUnusedModelCredentials } from "@/src/server/models/configuration";
import {
  createConversationRepository,
  type ConversationEventRepository,
} from "./repository";
import { serviceIdentity } from "./service-identity";
import type { EveGateway } from "./types";

const CREDENTIAL_RELEASE_EVENTS = new Set<HandleMessageStreamEvent["type"]>([
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
  "session.failed",
  "session.completed",
]);

export async function applyConversationEvent(
  conversationId: string,
  cursor: number,
  event: HandleMessageStreamEvent,
  repository: ConversationEventRepository = createConversationRepository(),
): Promise<boolean> {
  const applied = await repository.applyEvent(conversationId, cursor, event);
  if (applied && CREDENTIAL_RELEASE_EVENTS.has(event.type)) {
    const conversation = await repository.getRuntimeConversationById(
      conversationId,
    );
    if (conversation) {
      await purgeUnusedModelCredentials(conversation.tenantId);
    }
  }
  return applied;
}

export async function monitorEveEvents(input: {
  readonly conversationId: string;
  readonly startIndex: number;
  readonly events: AsyncIterable<HandleMessageStreamEvent>;
  readonly repository?: ConversationEventRepository;
  readonly eve?: EveGateway;
}): Promise<void> {
  const repository = input.repository ?? createConversationRepository();
  const subagentMonitors = new Map<string, Promise<void>>();
  let cursor = input.startIndex;
  try {
    for await (const event of input.events) {
      const applied = await applyConversationEvent(
        input.conversationId,
        cursor,
        event,
        repository,
      );
      cursor += 1;

      if (applied && event.type === "subagent.called" && input.eve) {
        const child = await repository.findSubagentProjection(
          input.conversationId,
          event.data.childSessionId,
        );
        if (child) {
          subagentMonitors.set(
            event.data.callId,
            monitorSubagentConversation(
              child.conversationId,
              repository,
              input.eve,
            ).catch((error) => {
              console.error(
                JSON.stringify({
                  level: "error",
                  event: "subagent_reconciliation_failed",
                  conversationId: child.conversationId,
                  ...operationalErrorMetadata(error),
                }),
              );
            }),
          );
        }
      }

      if (event.type === "subagent.completed") {
        const monitor = subagentMonitors.get(event.data.callId);
        if (monitor) {
          await monitor;
          subagentMonitors.delete(event.data.callId);
        }
      }
    }
  } finally {
    await Promise.allSettled(subagentMonitors.values());
  }
}

async function monitorSubagentConversation(
  conversationId: string,
  repository: ConversationEventRepository,
  eve: EveGateway,
): Promise<void> {
  const runtime = await repository.getRuntimeConversationById(conversationId);
  if (!runtime?.eveSessionId) return;

  await monitorEveEvents({
    conversationId,
    startIndex: runtime.nextStreamIndex,
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
      startIndex: runtime.nextStreamIndex,
      follow: true,
    }),
    repository,
    eve,
  });
}
