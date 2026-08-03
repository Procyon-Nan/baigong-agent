import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { HandleMessageStreamEvent } from "eve/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDatabase } from "@/src/server/db/client";
import {
  conversationTurns,
  conversations,
  modelConfigurations,
  modelConfigVersions,
  securityAuditEvents,
} from "@/src/server/db/schema";
import type { EveGateway } from "@/src/server/conversations/types";
import type { ConversationRepository } from "@/src/server/conversations/repository";
import type {
  ReservedConversationTurn,
} from "@/src/server/conversations/types";
import type { ServiceSessionIdentity } from "@/src/server/conversations/session-mapping";
import {
  decryptContinuationToken,
  decryptModelApiKey,
  encryptContinuationToken,
} from "@/src/server/models/credentials";
import {
  cleanupP3TestContext,
  cleanupP3TestDataDirectories,
  configureP3TestDatabase,
  createP3TestContext,
  migrateP3TestDatabase,
  type P3TestContext,
} from "./support/p3-test-database";

configureP3TestDatabase();

const contexts: P3TestContext[] = [];

describe("P3 database acceptance", () => {
  beforeAll(async () => {
    await migrateP3TestDatabase();
  });

  afterAll(async () => {
    try {
      for (const context of contexts.reverse()) {
        await cleanupP3TestContext(context);
      }
    } finally {
      const { closeDatabase } = await import("@/src/server/db/client");
      await closeDatabase();
      await cleanupP3TestDataDirectories();
    }
  });

  it("serializes model versions and purges credentials that are no longer referenced", async () => {
    const context = await testContext("model-versions");
    const {
      getCurrentModelConfiguration,
      resolveModelConfigurationVersion,
      saveModelConfiguration,
    } = await import("@/src/server/models/configuration");
    const inputs = Array.from({ length: 4 }, (_, index) => ({
      providerDisplayName: `Fake Provider ${index}`,
      baseUrl: `http://127.0.0.1:${41_000 + index}/v1`,
      modelName: `fake-model-${index}`,
      contextWindowTokens: 8_192 + index,
      apiKey: `p3-fake-key-${context.suffix}-${index}`,
    }));

    const saved = await Promise.all(
      inputs.map((input) => saveModelConfiguration(context.administrator, input)),
    );
    const versions = await getDatabase()
      .select()
      .from(modelConfigVersions)
      .where(eq(modelConfigVersions.tenantId, context.tenantId))
      .orderBy(asc(modelConfigVersions.version));
    const [pointer] = await getDatabase()
      .select()
      .from(modelConfigurations)
      .where(eq(modelConfigurations.tenantId, context.tenantId));
    const current = await getCurrentModelConfiguration(context.administrator);

    expect(versions.map(({ version }) => version)).toEqual([1, 2, 3, 4]);
    expect(pointer?.currentVersionId).toBe(current?.id);
    expect(current?.version).toBe(4);

    const currentInput = inputs.find(
      ({ modelName }) => modelName === current?.modelName,
    );
    expect(currentInput).toBeDefined();
    const resolved = await resolveModelConfigurationVersion(
      context.tenantId,
      current!.id,
    );
    expect(resolved.apiKey).toBe(currentInput?.apiKey);
    expect(JSON.stringify(saved)).not.toContain("p3-fake-key");

    for (const version of versions) {
      if (version.id === current?.id) {
        expect(version.encryptedApiKey).toBeTruthy();
        expect(version.encryptedApiKey).not.toContain(currentInput!.apiKey);
        await expect(
          decryptModelApiKey(version.encryptedApiKey!, {
            tenantId: context.tenantId,
            versionId: randomUUID(),
            version: version.version,
          }),
        ).rejects.toMatchObject({ code: "ENCRYPTED_VALUE_INVALID" });
      } else {
        expect(version.encryptedApiKey).toBeNull();
        expect(version.credentialPurgedAt).toBeInstanceOf(Date);
      }
    }
  }, 30_000);

  it("enforces ownership, request idempotency, and the per-user activity limit", async () => {
    const owner = await testContext("owner");
    const outsider = await testContext("outsider");
    await configureModel(owner);
    await configureModel(outsider);
    const { createConversationRepository } = await import(
      "@/src/server/conversations/repository"
    );
    const repository = createConversationRepository();
    const requestId = randomUUID();
    const first = await repository.reserveCreation(owner.administrator, {
      message: "hello",
      requestId,
    });
    expect(first.kind).toBe("reserved");
    const duplicate = await repository.reserveCreation(
      owner.administrator,
      { message: "hello", requestId },
    );
    expect(duplicate).toMatchObject({
      kind: "duplicate",
      value: {
        conversationId: first.value.conversationId,
        turnId: first.value.turnId,
      },
    });

    await expect(
      repository.getOwnedConversation(
        outsider.administrator,
        first.value.conversationId,
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

    await repository.reserveCreation(owner.administrator, {
      message: "second",
      requestId: randomUUID(),
    });
    await repository.reserveCreation(owner.administrator, {
      message: "third",
      requestId: randomUUID(),
    });
    await expect(
      repository.reserveCreation(owner.administrator, {
        message: "fourth",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "USER_CONCURRENCY_LIMIT" });
  }, 30_000);

  it("expires only stale unconfirmed submissions", async () => {
    const context = await testContext("submission-expiry");
    await configureModel(context);
    const { createConversationRepository } = await import(
      "@/src/server/conversations/repository"
    );
    const repository = createConversationRepository();
    const submission = await repository.reserveCreation(
      context.administrator,
      { message: "hello", requestId: randomUUID() },
    );
    expect(submission.kind).toBe("reserved");
    if (submission.kind !== "reserved") throw new Error("Expected a reservation.");

    await expect(
      repository.expireUnconfirmedSubmission(submission.value.conversationId),
    ).resolves.toBe(false);

    await getDatabase()
      .update(conversations)
      .set({ updatedAt: new Date(Date.now() - 10 * 60 * 1_000) })
      .where(eq(conversations.id, submission.value.conversationId));
    await expect(
      repository.expireUnconfirmedSubmission(submission.value.conversationId),
    ).resolves.toBe(true);

    const [expired] = await getDatabase()
      .select()
      .from(conversations)
      .where(eq(conversations.id, submission.value.conversationId));
    expect(expired).toMatchObject({
      status: "TERMINAL_FAILED",
      activeTurnId: null,
    });
  }, 30_000);

  it("recovers the eve session mapping across BFF acceptance races", async () => {
    const hookFirst = await testContext("mapping-hook-first");
    const bffFirst = await testContext("mapping-bff-first");
    await configureModel(hookFirst);
    await configureModel(bffFirst);
    const { createConversationRepository } = await import(
      "@/src/server/conversations/repository"
    );
    const { recoverConversationSessionMapping } = await import(
      "@/src/server/conversations/session-mapping"
    );
    const repository = createConversationRepository();

    const hookFirstReservation = await repository.reserveCreation(
      hookFirst.administrator,
      { message: "hello", requestId: randomUUID() },
    );
    expect(hookFirstReservation.kind).toBe("reserved");
    if (hookFirstReservation.kind !== "reserved") {
      throw new Error("Expected a reservation.");
    }
    const hookFirstSessionId = `eve-${randomUUID()}`;
    await recoverConversationSessionMapping(
      serviceSessionIdentity(hookFirst, hookFirstReservation.value),
      hookFirstSessionId,
    );
    await acceptMappedCreation(
      repository,
      hookFirstReservation.value,
      hookFirstSessionId,
    );
    await expect(
      recoverConversationSessionMapping(
        serviceSessionIdentity(hookFirst, hookFirstReservation.value),
        hookFirstSessionId,
      ),
    ).resolves.toBeUndefined();

    const bffFirstReservation = await repository.reserveCreation(
      bffFirst.administrator,
      { message: "hello", requestId: randomUUID() },
    );
    expect(bffFirstReservation.kind).toBe("reserved");
    if (bffFirstReservation.kind !== "reserved") {
      throw new Error("Expected a reservation.");
    }
    const bffFirstSessionId = `eve-${randomUUID()}`;
    await repository.recordCreationSession(
      bffFirstReservation.value,
      bffFirstSessionId,
    );
    await acceptMappedCreation(
      repository,
      bffFirstReservation.value,
      bffFirstSessionId,
    );
    await expect(
      recoverConversationSessionMapping(
        serviceSessionIdentity(bffFirst, bffFirstReservation.value),
        bffFirstSessionId,
      ),
    ).resolves.toBeUndefined();
    await repository.applyEvent(
      hookFirstReservation.value.conversationId,
      0,
      event("turn.started", { turnId: "turn_0", sequence: 0 }),
    );
    await repository.applyEvent(
      bffFirstReservation.value.conversationId,
      0,
      event("turn.started", { turnId: "turn_0", sequence: 0 }),
    );
    await expect(
      recoverConversationSessionMapping(
        serviceSessionIdentity(bffFirst, bffFirstReservation.value),
        `eve-${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_PERSISTENCE_FAILED" });
  }, 30_000);

  it("settles and audits identity cancellation before eve accepts a session", async () => {
    const context = await testContext("identity-cancellation");
    await configureModel(context);
    const { createConversationRepository } = await import(
      "@/src/server/conversations/repository"
    );
    const { cancelActiveRepliesForUser } = await import(
      "@/src/server/conversations/identity-cancellation"
    );
    const repository = createConversationRepository();
    const submission = await repository.reserveCreation(
      context.administrator,
      { message: "hello", requestId: randomUUID() },
    );
    expect(submission.kind).toBe("reserved");
    if (submission.kind !== "reserved") throw new Error("Expected a reservation.");
    const eve = eveGateway();

    await cancelActiveRepliesForUser(
      context.administrator,
      context.administrator.userId,
      "USER_PASSWORD_RESET",
      { eve },
    );

    const [conversation] = await getDatabase()
      .select()
      .from(conversations)
      .where(eq(conversations.id, submission.value.conversationId));
    const [turn] = await getDatabase()
      .select()
      .from(conversationTurns)
      .where(eq(conversationTurns.id, submission.value.turnId));
    const [audit] = await getDatabase()
      .select()
      .from(securityAuditEvents)
      .where(eq(securityAuditEvents.targetId, submission.value.conversationId));

    expect(conversation).toMatchObject({
      status: "TERMINAL_FAILED",
      activeTurnId: null,
    });
    expect(turn).toMatchObject({ status: "CANCELLED" });
    expect(audit).toMatchObject({
      action: "IDENTITY_CHANGE_ACTIVE_REPLY_CANCELLED",
      outcome: "SUCCESS",
    });
    expect(eve.cancelTurn).not.toHaveBeenCalled();
  }, 30_000);

  it("locks turn model versions and rotates continuation ciphertext", async () => {
    const context = await testContext("turn-version");
    const firstModel = await configureModel(context, "model-one");
    const { createConversationRepository } = await import(
      "@/src/server/conversations/repository"
    );
    const repository = createConversationRepository();
    const first = await repository.reserveCreation(
      context.administrator,
      { message: "hello", requestId: randomUUID() },
    );
    expect(first.kind).toBe("reserved");
    expect(first.value.modelConfigVersionId).toBe(firstModel.id);

    const initialToken = `initial-${randomUUID()}`;
    const initialCiphertext = await encryptContinuationToken(initialToken, {
      tenantId: context.tenantId,
      conversationId: first.value.conversationId,
      revision: 1,
    });
    const sessionId = `eve-${randomUUID()}`;
    await repository.recordCreationSession(first.value, sessionId);
    await repository.acceptCreation(first.value, {
      eveSessionId: sessionId,
      encryptedContinuationToken: initialCiphertext,
      continuationTokenRevision: 1,
    });

    const eveTurnId = `turn-${randomUUID()}`;
    await repository.applyEvent(
      first.value.conversationId,
      0,
      event("turn.started", { turnId: eveTurnId, sequence: 1 }),
    );
    await repository.applyEvent(
      first.value.conversationId,
      1,
      event("turn.completed", { turnId: eveTurnId }),
    );
    const rotatedToken = `rotated-${randomUUID()}`;
    await repository.applyEvent(
      first.value.conversationId,
      2,
      event("session.waiting", { continuationToken: rotatedToken }),
    );
    await expect(
      repository.applyEvent(
        first.value.conversationId,
        2,
        event("session.waiting", { continuationToken: "duplicate" }),
      ),
    ).resolves.toBe(false);

    const [waiting] = await getDatabase()
      .select()
      .from(conversations)
      .where(eq(conversations.id, first.value.conversationId));
    expect(waiting?.continuationTokenRevision).toBe(2);
    expect(waiting?.encryptedContinuationToken).not.toContain(rotatedToken);
    await expect(
      decryptContinuationToken(waiting!.encryptedContinuationToken!, {
        tenantId: context.tenantId,
        conversationId: first.value.conversationId,
        revision: 2,
      }),
    ).resolves.toBe(rotatedToken);

    const secondModel = await configureModel(context, "model-two");
    const second = await repository.reserveContinuation(
      context.administrator,
      first.value.conversationId,
      { message: "next", requestId: randomUUID() },
    );
    expect(second.kind).toBe("reserved");
    expect(second.value.modelConfigVersionId).toBe(secondModel.id);
    expect(second.value.modelConfigVersionId).not.toBe(firstModel.id);

    const turns = await getDatabase()
      .select({ id: conversationTurns.id, model: conversationTurns.modelConfigVersionId })
      .from(conversationTurns)
      .where(eq(conversationTurns.conversationId, first.value.conversationId));
    expect(turns).toEqual(
      expect.arrayContaining([
        { id: first.value.turnId, model: firstModel.id },
        { id: second.value.turnId, model: secondModel.id },
      ]),
    );
  }, 30_000);

  it("serializes submissions in one conversation and handles cancellation races", async () => {
    const context = await testContext("submission-races");
    await configureModel(context);
    const { createConversationRepository } = await import(
      "@/src/server/conversations/repository"
    );
    const repository = createConversationRepository();
    const first = await repository.reserveCreation(
      context.administrator,
      { message: "hello", requestId: randomUUID() },
    );
    expect(first.kind).toBe("reserved");
    const sessionId = `eve-${randomUUID()}`;
    const ciphertext = await encryptContinuationToken("continuation", {
      tenantId: context.tenantId,
      conversationId: first.value.conversationId,
      revision: 1,
    });
    await repository.recordCreationSession(first.value, sessionId);
    await repository.acceptCreation(first.value, {
      eveSessionId: sessionId,
      encryptedContinuationToken: ciphertext,
      continuationTokenRevision: 1,
    });
    const eveTurnId = `turn-${randomUUID()}`;
    await repository.applyEvent(
      first.value.conversationId,
      0,
      event("turn.started", { turnId: eveTurnId, sequence: 1 }),
    );
    await repository.applyEvent(
      first.value.conversationId,
      1,
      event("turn.completed", { turnId: eveTurnId }),
    );
    await expect(
      repository.reserveCancellation(
        context.administrator,
        first.value.conversationId,
        first.value.turnId,
      ),
    ).resolves.toEqual({ kind: "no_active_turn" });
    await repository.applyEvent(
      first.value.conversationId,
      2,
      event("session.waiting", { continuationToken: "next" }),
    );

    const attempts = await Promise.allSettled([
      repository.reserveContinuation(
        context.administrator,
        first.value.conversationId,
        { message: "next one", requestId: randomUUID() },
      ),
      repository.reserveContinuation(
        context.administrator,
        first.value.conversationId,
        { message: "next two", requestId: randomUUID() },
      ),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const accepted = attempts.find(
      (
        attempt,
      ): attempt is PromiseFulfilledResult<
        Awaited<ReturnType<typeof repository.reserveContinuation>>
      > =>
        attempt.status === "fulfilled",
    )!.value;
    expect(accepted.kind).toBe("reserved");
    if (accepted.kind !== "reserved") throw new Error("Expected a reservation.");

    await expect(
      repository.reserveCancellation(
        context.administrator,
        first.value.conversationId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "TURN_CHANGED" });
    const cancellation = await repository.reserveCancellation(
      context.administrator,
      first.value.conversationId,
      accepted.value.turnId,
    );
    expect(cancellation.kind).toBe("reserved");
    if (cancellation.kind !== "reserved") throw new Error("Expected cancellation.");
    await repository.settleUnresolvedCancellation(cancellation.value);
    await expect(
      repository.reserveCancellation(
        context.administrator,
        first.value.conversationId,
        accepted.value.turnId,
      ),
    ).resolves.toEqual({ kind: "no_active_turn" });
  }, 30_000);
});

async function testContext(label: string): Promise<P3TestContext> {
  const context = await createP3TestContext(label);
  contexts.push(context);
  return context;
}

async function configureModel(
  context: P3TestContext,
  modelName = `fake-${randomUUID()}`,
) {
  const { saveModelConfiguration } = await import(
    "@/src/server/models/configuration"
  );
  return saveModelConfiguration(context.administrator, {
    providerDisplayName: "P3 Fake Provider",
    baseUrl: "http://127.0.0.1:41999/v1",
    modelName,
    contextWindowTokens: 8_192,
    apiKey: `fake-${randomUUID()}`,
  });
}

function serviceSessionIdentity(
  context: P3TestContext,
  reservation: ReservedConversationTurn,
): ServiceSessionIdentity {
  return {
    authenticator: "baigong-bff",
    principalId: context.administrator.userId,
    attributes: {
      tenantId: context.tenantId,
      role: context.administrator.role,
      source: context.administrator.source,
      conversationId: reservation.conversationId,
      turnId: reservation.turnId,
      modelConfigVersionId: reservation.modelConfigVersionId,
    },
  };
}

async function acceptMappedCreation(
  repository: ConversationRepository,
  reservation: ReservedConversationTurn,
  eveSessionId: string,
): Promise<void> {
  await repository.acceptCreation(reservation, {
    eveSessionId,
    encryptedContinuationToken: null,
    continuationTokenRevision: 0,
  });
}

function event(
  type: HandleMessageStreamEvent["type"],
  data: Record<string, unknown>,
): HandleMessageStreamEvent {
  return {
    type,
    data,
    meta: { at: new Date().toISOString() },
  } as HandleMessageStreamEvent;
}

function eveGateway(): EveGateway {
  return {
    startTurn: vi.fn(),
    continueTurn: vi.fn(),
    cancelTurn: vi.fn(),
    streamSession: vi.fn(() => emptyEvents()),
  };
}

async function* emptyEvents() {}
