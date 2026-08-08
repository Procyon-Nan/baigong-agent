import { randomUUID } from "node:crypto";

import type { ConversationRepository } from "@/src/server/conversations/repository";
import type { ReservedConversationTurn } from "@/src/server/conversations/types";
import { encryptContinuationToken } from "@/src/server/models/credentials";
import type { P4TestContext } from "./p4-test-database";

export async function prepareP4Conversation(
  context: P4TestContext,
  message: string,
  contextWindowTokens = 8_192,
): Promise<{
  readonly repository: ConversationRepository;
  readonly reservation: ReservedConversationTurn;
}> {
  await configureP4Model(context, contextWindowTokens);

  const { createConversationRepository } = await import(
    "@/src/server/conversations/repository"
  );
  const repository = createConversationRepository();
  const reserved = await repository.reserveCreation(context.administrator, {
    message,
    requestId: randomUUID(),
  });
  if (reserved.kind !== "reserved") throw new Error("Expected a reservation.");

  const eveSessionId = `session-${randomUUID()}`;
  const encryptedContinuationToken = await encryptContinuationToken(
    `token-${randomUUID()}`,
    {
      tenantId: context.tenantId,
      conversationId: reserved.value.conversationId,
      revision: 1,
    },
  );
  await repository.recordCreationSession(reserved.value, eveSessionId);
  await repository.acceptCreation(reserved.value, {
    eveSessionId,
    encryptedContinuationToken,
    continuationTokenRevision: 1,
  });
  return { repository, reservation: reserved.value };
}

export async function configureP4Model(
  context: P4TestContext,
  contextWindowTokens: number,
): Promise<void> {
  const { saveModelConfiguration } = await import(
    "@/src/server/models/configuration"
  );
  await saveModelConfiguration(context.administrator, {
    providerDisplayName: "P4 Fake Provider",
    baseUrl: "http://127.0.0.1:41999/v1",
    modelName: `fake-${randomUUID()}`,
    contextWindowTokens,
    supportsImageInput: false,
    supportsNativePdfInput: false,
    apiKey: `fake-${randomUUID()}`,
  });
}
