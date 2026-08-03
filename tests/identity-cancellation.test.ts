import { describe, expect, it, vi } from "vitest";
import type { AdminPrincipal } from "@/src/server/auth/principal";
import { cancelActiveRepliesForUser } from "@/src/server/conversations/identity-cancellation";
import type {
  EveGateway,
  ReservedConversationTurn,
} from "@/src/server/conversations/types";

const actor: AdminPrincipal = {
  userId: "admin-1",
  tenantId: "11111111-1111-4111-8111-111111111111",
  role: "ADMIN",
  source: "LOCAL",
  sessionId: "admin-session",
  integrationId: null,
  displayName: "Administrator",
  mustChangePassword: false,
};

const reservation: ReservedConversationTurn & {
  readonly role: "USER";
  readonly eveSessionId: string;
} = {
  conversationId: "22222222-2222-4222-8222-222222222222",
  turnId: "33333333-3333-4333-8333-333333333333",
  tenantId: actor.tenantId,
  ownerUserId: "user-1",
  ownerSource: "LOCAL",
  modelConfigVersionId: "44444444-4444-4444-8444-444444444444",
  eveTurnId: "eve-turn-1",
  conversationStatus: "CANCELLING",
  turnStatus: "CANCELLING",
  eveSessionId: "eve-session-1",
  encryptedContinuationToken: "encrypted-token",
  continuationTokenRevision: 1,
  nextStreamIndex: 7,
  createdAt: new Date("2026-07-30T08:00:00.000Z"),
  updatedAt: new Date("2026-07-30T08:01:00.000Z"),
  role: "USER",
};

describe("identity-change reply cancellation", () => {
  it("audits a locally settled reservation without contacting eve", async () => {
    const recordAudit = vi.fn().mockResolvedValue(undefined);
    const eve = eveStub();

    await cancelActiveRepliesForUser(actor, reservation.ownerUserId, "USER_DISABLED", {
      eve,
      reserve: vi.fn().mockResolvedValue({
        reservations: [],
        settled: [
          {
            conversationId: reservation.conversationId,
            ownerUserId: reservation.ownerUserId,
          },
        ],
      }),
      repository: { settleUnresolvedCancellation: vi.fn() },
      recordAudit,
    });

    expect(eve.cancelTurn).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      actor,
      {
        conversationId: reservation.conversationId,
        ownerUserId: reservation.ownerUserId,
      },
      "USER_DISABLED",
      "SUCCESS",
    );
  });

  it("settles an eve session that no longer has an active turn", async () => {
    const settleUnresolvedCancellation = vi.fn().mockResolvedValue(undefined);
    const recordAudit = vi.fn().mockResolvedValue(undefined);
    const monitor = vi.fn().mockResolvedValue(undefined);
    const eve = eveStub({
      cancelTurn: vi.fn().mockResolvedValue("no_active_turn"),
    });

    await cancelActiveRepliesForUser(
      actor,
      reservation.ownerUserId,
      "USER_ROLE_CHANGED",
      {
        eve,
        reserve: reservedCancellation,
        repository: { settleUnresolvedCancellation },
        recordAudit,
        monitor,
      },
    );

    expect(eve.cancelTurn).toHaveBeenCalledWith({
      identity: {
        userId: reservation.ownerUserId,
        tenantId: reservation.tenantId,
        role: reservation.role,
        source: reservation.ownerSource,
        conversationId: reservation.conversationId,
        turnId: reservation.turnId,
        modelConfigVersionId: reservation.modelConfigVersionId,
      },
      sessionId: reservation.eveSessionId,
      eveTurnId: reservation.eveTurnId,
    });
    expect(settleUnresolvedCancellation).toHaveBeenCalledWith(reservation);
    expect(monitor).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      actor,
      reservation,
      "USER_ROLE_CHANGED",
      "SUCCESS",
    );
  });

  it("starts durable stream monitoring after eve accepts cancellation", async () => {
    const monitor = vi.fn().mockResolvedValue(undefined);
    const settleUnresolvedCancellation = vi.fn();
    const eve = eveStub({
      cancelTurn: vi.fn().mockResolvedValue("accepted"),
    });

    await cancelActiveRepliesForUser(
      actor,
      reservation.ownerUserId,
      "USER_PASSWORD_RESET",
      {
        eve,
        reserve: reservedCancellation,
        repository: { settleUnresolvedCancellation },
        recordAudit: vi.fn().mockResolvedValue(undefined),
        monitor,
      },
    );

    expect(monitor).toHaveBeenCalledWith(reservation, eve);
    expect(settleUnresolvedCancellation).not.toHaveBeenCalled();
  });

  it("keeps the durable cancellation reservation after an eve failure", async () => {
    const failure = new Error("eve unavailable");
    const settleUnresolvedCancellation = vi.fn();
    const recordAudit = vi.fn().mockResolvedValue(undefined);

    await expect(
      cancelActiveRepliesForUser(
        actor,
        reservation.ownerUserId,
        "USER_DISABLED",
        {
          eve: eveStub({ cancelTurn: vi.fn().mockRejectedValue(failure) }),
          reserve: reservedCancellation,
          repository: { settleUnresolvedCancellation },
          recordAudit,
          monitor: vi.fn(),
        },
      ),
    ).resolves.toBeUndefined();

    expect(settleUnresolvedCancellation).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      actor,
      reservation,
      "USER_DISABLED",
      "FAILURE",
    );
  });
});

async function reservedCancellation() {
  return { reservations: [reservation], settled: [] };
}

function eveStub(overrides: Partial<EveGateway> = {}): EveGateway {
  return {
    startTurn: vi.fn(),
    continueTurn: vi.fn(),
    cancelTurn: vi.fn().mockResolvedValue("accepted"),
    streamSession: vi.fn(() => emptyEvents()),
    ...overrides,
  };
}

async function* emptyEvents() {}
