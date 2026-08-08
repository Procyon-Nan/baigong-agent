import { describe, expect, it, vi } from "vitest";
import { reconcileConversation } from "@/src/server/conversations/reconciliation";
import type { ConversationReconciliationRepository } from "@/src/server/conversations/repository";
import type { EveGateway, RuntimeConversation } from "@/src/server/conversations/types";

const runtime: RuntimeConversation = {
  conversationId: "22222222-2222-4222-8222-222222222222",
  turnId: "33333333-3333-4333-8333-333333333333",
  tenantId: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "user-1",
  ownerSource: "LOCAL",
  role: "USER",
  modelConfigVersionId: "44444444-4444-4444-8444-444444444444",
  agentConfigVersionId: "55555555-5555-4555-8555-555555555555",
  eveTurnId: null,
  conversationStatus: "STARTING",
  turnStatus: "SUBMITTING",
  eveSessionId: null,
  encryptedContinuationToken: null,
  continuationTokenRevision: 0,
  nextStreamIndex: 0,
  createdAt: new Date("2026-07-30T08:00:00.000Z"),
  updatedAt: new Date("2026-07-30T08:00:00.000Z"),
  kind: "MAIN",
  linkStatus: "NOT_APPLICABLE",
  parentConversationId: null,
};

describe("conversation startup reconciliation", () => {
  it("expires a pre-dispatch reservation only when startup recovery requests it", async () => {
    const expireUnconfirmedSubmission = vi.fn().mockResolvedValue(true);
    const repository = reconciliationRepository({
      getRuntimeConversationById: vi.fn().mockResolvedValue(runtime),
      expireUnconfirmedSubmission,
    });

    await expect(
      reconcileConversation(runtime.conversationId, { repository }),
    ).resolves.toBe("mapping_pending");
    expect(expireUnconfirmedSubmission).not.toHaveBeenCalled();

    await expect(
      reconcileConversation(runtime.conversationId, {
        repository,
        expireUnconfirmedSubmission: true,
      }),
    ).resolves.toBe("submission_expired");
  });

  it("reads mapped eve events before expiring an unconfirmed submission", async () => {
    const expireUnconfirmedSubmission = vi.fn().mockResolvedValue(true);
    const applyEvent = vi.fn().mockResolvedValue(true);
    const repository = reconciliationRepository({
      getRuntimeConversationById: vi.fn().mockResolvedValue({
        ...runtime,
        eveSessionId: "eve-session",
      }),
      getReconciliationStartIndex: vi.fn().mockResolvedValue(4),
      expireUnconfirmedSubmission,
      applyEvent,
    });
    const streamSession = vi.fn().mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "turn.started",
          data: { turnId: "eve-turn", sequence: 1 },
        };
      },
    });

    await expect(
      reconcileConversation(runtime.conversationId, {
        repository,
        eve: eveGateway({ streamSession }),
        expireUnconfirmedSubmission: true,
      }),
    ).resolves.toBe("submission_expired");
    expect(applyEvent).toHaveBeenCalledBefore(expireUnconfirmedSubmission);
    expect(streamSession).toHaveBeenCalledWith(
      expect.objectContaining({ startIndex: 4 }),
    );
  });
});

function reconciliationRepository(
  overrides: Partial<ConversationReconciliationRepository>,
): ConversationReconciliationRepository {
  return {
    applyEvent: vi.fn().mockResolvedValue(true),
    expireUnconfirmedSubmission: vi.fn().mockResolvedValue(false),
    findSubagentProjection: vi.fn().mockResolvedValue(null),
    getReconciliationStartIndex: vi.fn().mockResolvedValue(0),
    getRuntimeConversationById: vi.fn().mockResolvedValue(null),
    listPendingConversationIds: vi.fn().mockResolvedValue([]),
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
