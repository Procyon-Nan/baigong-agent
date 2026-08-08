import { describe, expect, it, vi } from "vitest";
import { monitorEveEvents } from "@/src/server/conversations/lifecycle";
import type { ConversationEventRepository } from "@/src/server/conversations/repository";
import type {
  EveGateway,
  RuntimeConversation,
} from "@/src/server/conversations/types";

const parentConversationId = "22222222-2222-4222-8222-222222222222";
const childConversationId = "33333333-3333-4333-8333-333333333333";
const childSessionId = "child-session";

describe("conversation lifecycle", () => {
  it("monitors a local child through settlement before releasing the parent call", async () => {
    const applyEvent = vi.fn().mockResolvedValue(true);
    const repository = eventRepository({
      applyEvent,
      findSubagentProjection: vi.fn().mockResolvedValue({
        conversationId: childConversationId,
        name: "agent",
        linkStatus: "PENDING",
        status: "STARTING",
      }),
      getRuntimeConversationById: vi
        .fn()
        .mockResolvedValueOnce(childRuntime())
        .mockResolvedValue(null),
    });
    const streamSession = vi.fn().mockReturnValue(
      eventStream([
        event("session.started", {}),
        event("turn.started", { sequence: 0, turnId: "turn_0" }),
        event("turn.completed", { sequence: 0, turnId: "turn_0" }),
        event("session.completed", {}),
      ]),
    );

    await monitorEveEvents({
      conversationId: parentConversationId,
      startIndex: 10,
      events: eventStream([
        event("subagent.called", {
          callId: "call_0",
          childSessionId,
          name: "agent",
          sequence: 0,
          sessionId: "parent-session",
          toolName: "agent",
          turnId: "turn_0",
          workflowId: "workflow-parent",
        }),
        event("subagent.completed", {
          callId: "call_0",
          output: "done",
          subagentName: "agent",
        }),
      ]),
      repository,
      eve: eveGateway({ streamSession }),
    });

    expect(streamSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: childSessionId,
        startIndex: 0,
        follow: true,
      }),
    );
    expect(applyEvent.mock.calls).toEqual(
      expect.arrayContaining([
        [childConversationId, 0, expect.objectContaining({ type: "session.started" })],
        [childConversationId, 3, expect.objectContaining({ type: "session.completed" })],
      ]),
    );
  });
});

function childRuntime(): RuntimeConversation {
  return {
    conversationId: childConversationId,
    turnId: "44444444-4444-4444-8444-444444444444",
    tenantId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "user-1",
    ownerSource: "LOCAL",
    role: "USER",
    modelConfigVersionId: "55555555-5555-4555-8555-555555555555",
    agentConfigVersionId: "66666666-6666-4666-8666-666666666666",
    eveTurnId: null,
    conversationStatus: "STARTING",
    turnStatus: "SUBMITTING",
    eveSessionId: childSessionId,
    encryptedContinuationToken: null,
    continuationTokenRevision: 0,
    nextStreamIndex: 0,
    createdAt: new Date("2026-08-07T04:00:00.000Z"),
    updatedAt: new Date("2026-08-07T04:00:00.000Z"),
    kind: "SUBAGENT",
    linkStatus: "PENDING",
    parentConversationId,
  };
}

function event(
  type: import("eve/client").HandleMessageStreamEvent["type"],
  data: Record<string, unknown>,
): import("eve/client").HandleMessageStreamEvent {
  return { type, data } as import("eve/client").HandleMessageStreamEvent;
}

async function* eventStream(
  events: readonly import("eve/client").HandleMessageStreamEvent[],
) {
  yield* events;
}

function eventRepository(
  overrides: Partial<ConversationEventRepository>,
): ConversationEventRepository {
  return {
    applyEvent: vi.fn().mockResolvedValue(true),
    findSubagentProjection: vi.fn().mockResolvedValue(null),
    getRuntimeConversationById: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function eveGateway(overrides: Partial<EveGateway>): EveGateway {
  return {
    startTurn: vi.fn(),
    continueTurn: vi.fn(),
    cancelTurn: vi.fn(),
    streamSession: vi.fn(),
    ...overrides,
  };
}
