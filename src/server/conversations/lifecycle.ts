import "server-only";

import type { HandleMessageStreamEvent } from "eve/client";
import { purgeUnusedModelCredentials } from "@/src/server/models/configuration";
import {
  createConversationRepository,
  type ConversationEventRepository,
} from "./repository";

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
}): Promise<void> {
  const repository = input.repository ?? createConversationRepository();
  let cursor = input.startIndex;
  for await (const event of input.events) {
    await applyConversationEvent(
      input.conversationId,
      cursor,
      event,
      repository,
    );
    cursor += 1;
  }
}
