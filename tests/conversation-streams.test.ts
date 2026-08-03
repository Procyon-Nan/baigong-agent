import type { HandleMessageStreamEvent } from "eve/client";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import { assistantMessageBlockId } from "@/src/server/conversations/message-identifiers";
import type { ConversationStreamRepository } from "@/src/server/conversations/repository";
import type {
  EveGateway,
  RuntimeConversation,
} from "@/src/server/conversations/types";
import { streamConversationEvents } from "@/src/server/eve/streams";

const principal: AuthenticatedPrincipal = {
  userId: "user-1",
  tenantId: "11111111-1111-4111-8111-111111111111",
  role: "USER",
  source: "LOCAL",
  sessionId: "auth-session",
  integrationId: null,
  displayName: "User",
  mustChangePassword: false,
};

const runtime: RuntimeConversation = {
  conversationId: "22222222-2222-4222-8222-222222222222",
  turnId: "33333333-3333-4333-8333-333333333333",
  tenantId: principal.tenantId,
  ownerUserId: principal.userId,
  ownerSource: principal.source,
  modelConfigVersionId: "44444444-4444-4444-8444-444444444444",
  eveTurnId: "eve-turn",
  conversationStatus: "RUNNING",
  turnStatus: "RUNNING",
  eveSessionId: "eve-session",
  encryptedContinuationToken: "encrypted-token",
  continuationTokenRevision: 1,
  nextStreamIndex: 0,
  createdAt: new Date("2026-07-30T08:00:00.000Z"),
  updatedAt: new Date("2026-07-30T08:00:00.000Z"),
  role: "USER",
};

describe("secure conversation stream", () => {
  it("filters raw events while preserving absolute cursor gaps", async () => {
    const applyEvent = vi.fn().mockResolvedValue(true);
    const streamSession = vi.fn<EveGateway["streamSession"]>(() =>
      eventStream([
        {
          type: "reasoning.appended",
          meta: { at: "2026-07-30T08:00:00.000Z" },
          data: {
            turnId: "eve-turn",
            reasoningDelta: "internal reasoning",
            reasoningSoFar: "internal reasoning",
          },
        } as HandleMessageStreamEvent,
        {
          type: "message.appended",
          meta: { at: "2026-07-30T08:00:01.000Z" },
          data: {
            turnId: "eve-turn",
            messageDelta: "answer",
            messageSoFar: "answer",
            sequence: 1,
            stepIndex: 0,
            providerSecret: "must-not-leak",
          },
        } as HandleMessageStreamEvent,
      ]),
    );
    const repository = repositoryStub({
      getRuntimeConversation: vi.fn().mockResolvedValue(runtime),
      applyEvent,
      findProjectionTurn: vi.fn().mockResolvedValue({
        turnId: runtime.turnId,
        publicErrorCode: null,
      }),
    });

    const stream = await streamConversationEvents({
      principal,
      conversationId: runtime.conversationId,
      after: -1,
      reauthorize: vi.fn().mockResolvedValue(principal),
      repository,
      eve: eveStub({ streamSession }),
    });
    const events = await readNdjson(stream);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "assistant.delta",
      conversationId: runtime.conversationId,
      cursor: 1,
      data: {
        turnId: runtime.turnId,
        blockId: assistantMessageBlockId(
          runtime.conversationId,
          runtime.turnId,
          0,
        ),
        delta: "answer",
        text: "answer",
      },
    });
    expect(JSON.stringify(events)).not.toContain("internal reasoning");
    expect(JSON.stringify(events)).not.toContain("providerSecret");
    expect(JSON.stringify(events)).not.toContain("eve-session");
    expect(applyEvent).toHaveBeenNthCalledWith(
      1,
      runtime.conversationId,
      0,
      expect.objectContaining({ type: "reasoning.appended" }),
    );
    expect(applyEvent).toHaveBeenNthCalledWith(
      2,
      runtime.conversationId,
      1,
      expect.objectContaining({ type: "message.appended" }),
    );
    expect(streamSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "eve-session",
        startIndex: 0,
      }),
    );
  });

  it("emits authentication expiry and closes when authority is revoked", async () => {
    const reauthorize = vi
      .fn<() => Promise<AuthenticatedPrincipal | null>>()
      .mockResolvedValueOnce(principal)
      .mockResolvedValueOnce(null);
    const repository = repositoryStub({
      getRuntimeConversation: vi
        .fn()
        .mockResolvedValue({ ...runtime, nextStreamIndex: 8 }),
    });
    const stream = await streamConversationEvents({
      principal,
      conversationId: runtime.conversationId,
      after: 7,
      reauthorize,
      repository,
      eve: eveStub({ streamSession: () => pendingEventStream() }),
      heartbeatIntervalMs: 1,
      authorizationCacheMs: 0,
      now: () => new Date("2026-07-30T08:00:00.000Z"),
    });
    const events = await readNdjson(stream);

    expect(events).toEqual([
      expect.objectContaining({
        type: "authentication.expired",
        cursor: 7,
        data: expect.objectContaining({
          error: expect.objectContaining({ code: "AUTHENTICATION_EXPIRED" }),
        }),
      }),
    ]);
    expect(reauthorize).toHaveBeenCalledTimes(2);
  });

  it("emits a heartbeat without advancing the durable cursor", async () => {
    const repository = repositoryStub({
      getRuntimeConversation: vi
        .fn()
        .mockResolvedValue({ ...runtime, nextStreamIndex: 5 }),
    });
    const stream = await streamConversationEvents({
      principal,
      conversationId: runtime.conversationId,
      after: 4,
      reauthorize: vi.fn().mockResolvedValue(principal),
      repository,
      eve: eveStub({ streamSession: () => pendingEventStream() }),
      heartbeatIntervalMs: 1,
      authorizationCacheMs: 0,
      now: () => new Date("2026-07-30T08:00:00.000Z"),
    });
    const reader = stream.getReader();
    const first = await reader.read();
    await reader.cancel();

    expect(first.done).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(first.value))).toMatchObject({
      type: "heartbeat",
      cursor: 4,
    });
  });

  it("clamps an untrusted future cursor to the authoritative database cursor", async () => {
    const streamSession = vi.fn<EveGateway["streamSession"]>(() =>
      eventStream([
        {
          type: "message.appended",
          meta: { at: "2026-07-30T08:00:01.000Z" },
          data: {
            turnId: "eve-turn",
            messageDelta: "answer",
            messageSoFar: "answer",
            sequence: 1,
            stepIndex: 0,
          },
        },
      ]),
    );
    const repository = repositoryStub({
      getRuntimeConversation: vi
        .fn()
        .mockResolvedValue({ ...runtime, nextStreamIndex: 3 }),
      applyEvent: vi.fn().mockResolvedValue(true),
      findProjectionTurn: vi.fn().mockResolvedValue({
        turnId: runtime.turnId,
        publicErrorCode: null,
      }),
    });

    const stream = await streamConversationEvents({
      principal,
      conversationId: runtime.conversationId,
      after: 99,
      reauthorize: vi.fn().mockResolvedValue(principal),
      repository,
      eve: eveStub({ streamSession }),
    });
    const events = await readNdjson(stream);

    expect(events).toEqual([
      expect.objectContaining({ type: "assistant.delta", cursor: 3 }),
    ]);
    expect(streamSession).toHaveBeenCalledWith(
      expect.objectContaining({ startIndex: 3 }),
    );
  });

  it("discards the persisted unfinished block when a turn fails", async () => {
    const hiddenBlockId = assistantMessageBlockId(
      runtime.conversationId,
      runtime.turnId,
      2,
    );
    const findLatestHiddenAssistantBlock = vi
      .fn()
      .mockResolvedValue(hiddenBlockId);
    const repository = repositoryStub({
      getRuntimeConversation: vi.fn().mockResolvedValue(runtime),
      applyEvent: vi.fn().mockResolvedValue(true),
      findProjectionTurn: vi.fn().mockResolvedValue({
        turnId: runtime.turnId,
        publicErrorCode: "MODEL_UNAVAILABLE",
      }),
      findLatestHiddenAssistantBlock,
    });
    const stream = await streamConversationEvents({
      principal,
      conversationId: runtime.conversationId,
      after: -1,
      reauthorize: vi.fn().mockResolvedValue(principal),
      repository,
      eve: eveStub({
        streamSession: () =>
          eventStream([
            {
              type: "message.appended",
              meta: { at: "2026-07-30T08:00:01.000Z" },
              data: {
                turnId: "eve-turn",
                messageDelta: "draft",
                messageSoFar: "draft",
                sequence: 1,
                stepIndex: 2,
              },
            },
            {
              type: "turn.failed",
              meta: { at: "2026-07-30T08:00:02.000Z" },
              data: {
                turnId: "eve-turn",
                code: "model_error",
                message: "unavailable",
              },
            },
          ] as HandleMessageStreamEvent[]),
      }),
    });

    expect(await readNdjson(stream)).toEqual([
      expect.objectContaining({
        type: "assistant.delta",
        data: expect.objectContaining({ blockId: hiddenBlockId }),
      }),
      expect.objectContaining({
        type: "turn.failed",
        data: expect.objectContaining({ discardBlockId: hiddenBlockId }),
      }),
    ]);
    expect(findLatestHiddenAssistantBlock).toHaveBeenCalledOnce();
    expect(findLatestHiddenAssistantBlock).toHaveBeenCalledWith(
      runtime.conversationId,
      runtime.turnId,
    );
  });

  it("does not consume an undelivered event when authorization expires", async () => {
    const reauthorize = vi
      .fn<() => Promise<AuthenticatedPrincipal | null>>()
      .mockResolvedValueOnce(principal)
      .mockResolvedValueOnce(null);
    const repository = repositoryStub({
      getRuntimeConversation: vi.fn().mockResolvedValue(runtime),
      applyEvent: vi.fn().mockResolvedValue(true),
    });
    const stream = await streamConversationEvents({
      principal,
      conversationId: runtime.conversationId,
      after: -1,
      reauthorize,
      repository,
      eve: eveStub({
        streamSession: () =>
          eventStream([
            {
              type: "message.appended",
              meta: { at: "2026-07-30T08:00:01.000Z" },
              data: {
                turnId: "eve-turn",
                messageDelta: "answer",
                messageSoFar: "answer",
                sequence: 1,
                stepIndex: 0,
              },
            },
          ]),
      }),
      authorizationCacheMs: 0,
      now: () => new Date("2026-07-30T08:00:00.000Z"),
    });

    expect(await readNdjson(stream)).toEqual([
      expect.objectContaining({ type: "authentication.expired", cursor: -1 }),
    ]);
  });
});

function repositoryStub(
  overrides: Partial<ConversationStreamRepository>,
): ConversationStreamRepository {
  return {
    applyEvent: vi.fn(),
    findLatestHiddenAssistantBlock: vi.fn(),
    findProjectionTurn: vi.fn(),
    getRuntimeConversation: vi.fn(),
    getRuntimeConversationById: vi.fn(),
    ...overrides,
  };
}

function eveStub(overrides: Partial<EveGateway>): EveGateway {
  return overrides as EveGateway;
}

async function* eventStream(
  events: readonly HandleMessageStreamEvent[],
): AsyncGenerator<HandleMessageStreamEvent> {
  for (const event of events) yield event;
}

function pendingEventStream(): AsyncIterable<HandleMessageStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<HandleMessageStreamEvent>>(() => {}),
        return: async () => ({ done: true, value: undefined }),
      };
    },
  };
}

async function readNdjson(
  stream: ReadableStream<Uint8Array>,
): Promise<unknown[]> {
  const text = await new Response(stream).text();
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}
