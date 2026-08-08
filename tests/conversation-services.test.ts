import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import { cancelConversationTurn } from "@/src/server/conversations/cancellation";
import { continueConversation } from "@/src/server/conversations/continuation";
import { createConversation } from "@/src/server/conversations/creation";
import type {
  ConversationCancellationRepository,
  ConversationContinuationRepository,
  ConversationCreationRepository,
} from "@/src/server/conversations/repository";
import type {
  EveGateway,
  PublicConversation,
  ReservedConversationTurn,
} from "@/src/server/conversations/types";
import { EveGatewayRejectedError } from "@/src/server/eve/client";

const principal: AuthenticatedPrincipal = {
  userId: "user-1",
  tenantId: "11111111-1111-4111-8111-111111111111",
  role: "USER",
  source: "LOCAL",
  sessionId: "session-1",
  integrationId: null,
  displayName: "User",
  mustChangePassword: false,
};

const reserved: ReservedConversationTurn = {
  conversationId: "22222222-2222-4222-8222-222222222222",
  turnId: "33333333-3333-4333-8333-333333333333",
  tenantId: principal.tenantId,
  ownerUserId: principal.userId,
  ownerSource: principal.source,
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
};

const publicConversation: PublicConversation = {
  id: reserved.conversationId,
  title: "hello",
  status: "RUNNING",
  activeTurn: { id: reserved.turnId, status: "RUNNING" },
  archivedAt: null,
  createdAt: reserved.createdAt.toISOString(),
  updatedAt: reserved.updatedAt.toISOString(),
};

describe("conversation creation", () => {
  it("returns an idempotent reservation without calling eve again", async () => {
    const startTurn = vi.fn<EveGateway["startTurn"]>();
    const repository = repositoryStub({
      reserveCreation: vi.fn().mockResolvedValue({
        kind: "duplicate",
        value: { ...reserved, turnStatus: "RUNNING" },
      }),
      getOwnedConversation: vi.fn().mockResolvedValue(publicConversation),
    });

    const result = await createConversation(
      principal,
      {
        message: "hello",
        requestId: "55555555-5555-4555-8555-555555555555",
      },
      { repository, eve: eveStub({ startTurn }) },
    );

    expect(result).toMatchObject({ duplicate: true, monitor: null });
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("marks an HTTP-rejected submission as failed", async () => {
    const rejectSubmission = vi.fn().mockResolvedValue(undefined);
    const repository = repositoryStub({
      reserveCreation: vi.fn().mockResolvedValue({
        kind: "reserved",
        message: "stored hello",
        value: reserved,
      }),
      rejectSubmission,
    });
    const rejected = new EveGatewayRejectedError(400, new Error("bad request"));

    await expect(
      createConversation(
        principal,
        { message: "hello", requestId: "55555555-5555-4555-8555-555555555555" },
        {
          repository,
          eve: eveStub({ startTurn: vi.fn().mockRejectedValue(rejected) }),
        },
      ),
    ).rejects.toMatchObject({ code: "EVE_REQUEST_REJECTED" });
    expect(rejectSubmission).toHaveBeenCalledWith(reserved);
  });

  it("keeps an ambiguous transport failure reserved for reconciliation", async () => {
    const rejectSubmission = vi.fn().mockResolvedValue(undefined);
    const repository = repositoryStub({
      reserveCreation: vi.fn().mockResolvedValue({
        kind: "reserved",
        message: "stored hello",
        value: reserved,
      }),
      rejectSubmission,
    });
    const transportFailure = new Error("connection reset");

    await expect(
      createConversation(
        principal,
        { message: "hello", requestId: "55555555-5555-4555-8555-555555555555" },
        {
          repository,
          eve: eveStub({
            startTurn: vi.fn().mockRejectedValue(transportFailure),
          }),
        },
      ),
    ).rejects.toBe(transportFailure);
    expect(rejectSubmission).not.toHaveBeenCalled();
  });

  it("monitors an accepted session when its initial token is absent", async () => {
    const recordCreationSession = vi.fn().mockResolvedValue(undefined);
    const acceptCreation = vi.fn().mockResolvedValue(undefined);
    const startTurn = vi.fn().mockResolvedValue({
      sessionId: "eve-session",
      continuationToken: null,
      events: emptyEvents(),
    });
    const repository = repositoryStub({
      reserveCreation: vi.fn().mockResolvedValue({
        kind: "reserved",
        message: "stored hello",
        value: reserved,
      }),
      recordCreationSession,
      acceptCreation,
      getOwnedConversation: vi.fn().mockResolvedValue(publicConversation),
    });

    const result = await createConversation(
      principal,
      {
        message: "hello",
        requestId: "55555555-5555-4555-8555-555555555555",
      },
      {
        repository,
        eve: eveStub({ startTurn }),
      },
    );
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ message: "stored hello" }),
    );
    expect(recordCreationSession).toHaveBeenCalledWith(reserved, "eve-session");
    expect(acceptCreation).toHaveBeenCalledWith(reserved, {
      eveSessionId: "eve-session",
      encryptedContinuationToken: null,
      continuationTokenRevision: 0,
    });
    expect(result.monitor).toEqual(expect.any(Function));
  });

  it("records the eve session before encrypting its continuation token", async () => {
    const acceptCreation = vi.fn().mockResolvedValue(undefined);
    const recordCreationSession = vi.fn().mockResolvedValue(undefined);
    const encryptToken = vi.fn().mockResolvedValue("encrypted-token");
    const repository = repositoryStub({
      reserveCreation: vi.fn().mockResolvedValue({
        kind: "reserved",
        message: "stored hello",
        value: reserved,
      }),
      recordCreationSession,
      acceptCreation,
      getOwnedConversation: vi.fn().mockResolvedValue(publicConversation),
    });

    const result = await createConversation(
      principal,
      { message: "hello", requestId: "55555555-5555-4555-8555-555555555555" },
      {
        repository,
        encryptToken,
        eve: eveStub({
          startTurn: vi.fn().mockResolvedValue({
            sessionId: "eve-session",
            continuationToken: "plain-token",
            events: emptyEvents(),
          }),
        }),
      },
    );

    expect(encryptToken).toHaveBeenCalledWith("plain-token", {
      tenantId: reserved.tenantId,
      conversationId: reserved.conversationId,
      revision: 1,
    });
    expect(recordCreationSession).toHaveBeenCalledWith(reserved, "eve-session");
    expect(acceptCreation).toHaveBeenCalledWith(reserved, {
      eveSessionId: "eve-session",
      encryptedContinuationToken: "encrypted-token",
      continuationTokenRevision: 1,
    });
    expect(result.duplicate).toBe(false);
  });
});

describe("conversation continuation", () => {
  it("uses the reserved model version and decrypts only the stored token", async () => {
    const continuation = {
      ...reserved,
      conversationStatus: "RUNNING" as const,
      eveSessionId: "eve-session",
      encryptedContinuationToken: "encrypted-token",
      continuationTokenRevision: 4,
      nextStreamIndex: 19,
    };
    const acceptContinuation = vi.fn().mockResolvedValue(undefined);
    const decryptToken = vi.fn().mockResolvedValue("plain-token");
    const continueTurn = vi.fn<EveGateway["continueTurn"]>().mockResolvedValue({
      sessionId: "eve-session",
      continuationToken: null,
      events: emptyEvents(),
    });
    const repository = repositoryStub({
      reserveContinuation: vi.fn().mockResolvedValue({
        kind: "reserved",
        message: "stored next",
        value: continuation,
      }),
      acceptContinuation,
      getOwnedConversation: vi.fn().mockResolvedValue(publicConversation),
    });

    await continueConversation(
      principal,
      continuation.conversationId,
      { message: "next", requestId: "66666666-6666-4666-8666-666666666666" },
      { repository, decryptToken, eve: eveStub({ continueTurn }) },
    );

    expect(decryptToken).toHaveBeenCalledWith("encrypted-token", {
      tenantId: continuation.tenantId,
      conversationId: continuation.conversationId,
      revision: 4,
    });
    expect(continueTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "eve-session",
        continuationToken: "plain-token",
        streamIndex: 19,
        message: "stored next",
        identity: expect.objectContaining({
          turnId: continuation.turnId,
          modelConfigVersionId: continuation.modelConfigVersionId,
        }),
      }),
    );
    expect(acceptContinuation).toHaveBeenCalledWith(
      continuation,
      "eve-session",
    );
  });

  it("releases a reservation when its continuation token cannot be decrypted", async () => {
    const continuation = {
      ...reserved,
      eveSessionId: "eve-session",
      encryptedContinuationToken: "encrypted-token",
      continuationTokenRevision: 4,
    };
    const rejectSubmission = vi.fn().mockResolvedValue(undefined);
    const continueTurn = vi.fn<EveGateway["continueTurn"]>();
    const repository = repositoryStub({
      reserveContinuation: vi.fn().mockResolvedValue({
        kind: "reserved",
        message: "stored next",
        value: continuation,
      }),
      rejectSubmission,
    });

    await expect(
      continueConversation(
        principal,
        continuation.conversationId,
        { message: "next", requestId: "66666666-6666-4666-8666-666666666666" },
        {
          repository,
          decryptToken: vi.fn().mockRejectedValue(new Error("wrong key")),
          eve: eveStub({ continueTurn }),
        },
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_UNAVAILABLE" });
    expect(rejectSubmission).toHaveBeenCalledWith(continuation);
    expect(continueTurn).not.toHaveBeenCalled();
  });
});

describe("conversation cancellation", () => {
  it("does not call eve when the observed turn is stale", async () => {
    const cancelTurn = vi.fn<EveGateway["cancelTurn"]>();
    const changed = Object.assign(new Error("turn changed"), {
      code: "TURN_CHANGED",
    });
    const repository = repositoryStub({
      reserveCancellation: vi.fn().mockRejectedValue(changed),
    });

    await expect(
      cancelConversationTurn(
        principal,
        reserved.conversationId,
        reserved.turnId,
        { repository, eve: eveStub({ cancelTurn }) },
      ),
    ).rejects.toBe(changed);
    expect(cancelTurn).not.toHaveBeenCalled();
  });

  it("restores the reservation and audits an administrator failure", async () => {
    const cancellation = {
      ...reserved,
      eveSessionId: "eve-session",
      conversationStatus: "CANCELLING" as const,
      turnStatus: "CANCELLING" as const,
    };
    const restoreCancellation = vi.fn().mockResolvedValue(undefined);
    const recordAdminCancellation = vi.fn().mockResolvedValue(undefined);
    const repository = repositoryStub({
      reserveCancellation: vi.fn().mockResolvedValue({
        kind: "reserved",
        value: cancellation,
        administeredForAnotherUser: true,
      }),
      restoreCancellation,
      recordAdminCancellation,
    });
    const failure = new Error("eve unavailable");

    await expect(
      cancelConversationTurn(
        { ...principal, role: "ADMIN" },
        cancellation.conversationId,
        cancellation.turnId,
        {
          repository,
          eve: eveStub({ cancelTurn: vi.fn().mockRejectedValue(failure) }),
        },
      ),
    ).rejects.toBe(failure);
    expect(restoreCancellation).toHaveBeenCalledWith(cancellation);
    expect(recordAdminCancellation).toHaveBeenCalledWith(
      expect.objectContaining({ role: "ADMIN" }),
      cancellation,
      "FAILURE",
    );
  });

  it("does not undo an accepted cancellation when success auditing fails", async () => {
    const cancellation = {
      ...reserved,
      eveSessionId: "eve-session",
      conversationStatus: "CANCELLING" as const,
      turnStatus: "CANCELLING" as const,
    };
    const restoreCancellation = vi.fn().mockResolvedValue(undefined);
    const auditFailure = new Error("audit unavailable");
    const repository = repositoryStub({
      reserveCancellation: vi.fn().mockResolvedValue({
        kind: "reserved",
        value: cancellation,
        administeredForAnotherUser: true,
      }),
      restoreCancellation,
      recordAdminCancellation: vi.fn().mockRejectedValue(auditFailure),
    });

    await expect(
      cancelConversationTurn(
        { ...principal, role: "ADMIN" },
        cancellation.conversationId,
        cancellation.turnId,
        {
          repository,
          eve: eveStub({ cancelTurn: vi.fn().mockResolvedValue("accepted") }),
        },
      ),
    ).rejects.toBe(auditFailure);
    expect(restoreCancellation).not.toHaveBeenCalled();
  });

  it("reconciles and settles an eve turn that is already inactive", async () => {
    const cancellation = {
      ...reserved,
      eveSessionId: "eve-session",
      conversationStatus: "CANCELLING" as const,
      turnStatus: "CANCELLING" as const,
    };
    const settleUnresolvedCancellation = vi.fn().mockResolvedValue(undefined);
    const reconcile = vi.fn().mockResolvedValue("reconciled");
    const repository = repositoryStub({
      reserveCancellation: vi.fn().mockResolvedValue({
        kind: "reserved",
        value: cancellation,
        administeredForAnotherUser: false,
      }),
      settleUnresolvedCancellation,
    });

    await expect(
      cancelConversationTurn(
        principal,
        cancellation.conversationId,
        cancellation.turnId,
        {
          repository,
          reconcile,
          eve: eveStub({
            cancelTurn: vi.fn().mockResolvedValue("no_active_turn"),
          }),
        },
      ),
    ).resolves.toEqual({ status: "no_active_turn" });
    expect(reconcile).toHaveBeenCalledWith(cancellation.conversationId, {
      repository,
      eve: expect.any(Object),
    });
    expect(settleUnresolvedCancellation).toHaveBeenCalledWith(cancellation);
  });

  it("keeps an inactive cancellation pending when reconciliation fails", async () => {
    const cancellation = {
      ...reserved,
      eveSessionId: "eve-session",
      conversationStatus: "CANCELLING" as const,
      turnStatus: "CANCELLING" as const,
    };
    const settleUnresolvedCancellation = vi.fn().mockResolvedValue(undefined);
    const reconcileFailure = new Error("stream unavailable");
    const repository = repositoryStub({
      reserveCancellation: vi.fn().mockResolvedValue({
        kind: "reserved",
        value: cancellation,
        administeredForAnotherUser: false,
      }),
      settleUnresolvedCancellation,
    });

    await expect(
      cancelConversationTurn(
        principal,
        cancellation.conversationId,
        cancellation.turnId,
        {
          repository,
          reconcile: vi.fn().mockRejectedValue(reconcileFailure),
          eve: eveStub({
            cancelTurn: vi.fn().mockResolvedValue("no_active_turn"),
          }),
        },
      ),
    ).rejects.toBe(reconcileFailure);
    expect(settleUnresolvedCancellation).not.toHaveBeenCalled();
  });
});

type ConversationServiceRepository = ConversationCreationRepository &
  ConversationContinuationRepository &
  ConversationCancellationRepository;

function repositoryStub(
  overrides: Partial<ConversationServiceRepository>,
): ConversationServiceRepository {
  return {
    acceptContinuation: vi.fn(),
    acceptCreation: vi.fn(),
    applyEvent: vi.fn(),
    expireUnconfirmedSubmission: vi.fn(),
    findSubagentProjection: vi.fn(),
    getOwnedConversation: vi.fn(),
    getRuntimeConversationById: vi.fn(),
    listPendingConversationIds: vi.fn(),
    recordAdminCancellation: vi.fn(),
    recordCreationSession: vi.fn(),
    rejectSubmission: vi.fn(),
    reserveCancellation: vi.fn(),
    reserveContinuation: vi.fn(),
    reserveCreation: vi.fn(),
    restoreCancellation: vi.fn(),
    settleUnresolvedCancellation: vi.fn(),
    ...overrides,
  };
}

function eveStub(overrides: Partial<EveGateway>): EveGateway {
  return overrides as EveGateway;
}

async function* emptyEvents() {}
