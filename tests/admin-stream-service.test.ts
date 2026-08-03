import { describe, expect, it, vi } from "vitest";
import type { AdminPrincipal } from "@/src/server/auth/principal";
import {
  authorizeAdminConversationStream,
  issueAdminConversationStreamToken,
  type AdminStreamRepository,
  type AdminStreamTarget,
} from "@/src/server/eve/admin-stream";
import type { VerifiedEveAdminStreamToken } from "@/src/server/eve/tokens";

const principal: AdminPrincipal = {
  userId: "admin-1",
  tenantId: "239f1821-ca26-41ba-a752-fb98fb4918b1",
  role: "ADMIN",
  source: "LOCAL",
  sessionId: "session-1",
  integrationId: null,
  displayName: "Administrator",
  mustChangePassword: false,
};
const target: AdminStreamTarget = {
  conversationId: "828e284a-3397-4663-bc4b-f6eddfae57d1",
  eveSessionId: "wrun_01ARYZ6S41TSV4RRFFQ69G5FAV",
  ownerUserId: "user-1",
};

describe("administrator event stream service", () => {
  it("issues a conversation-bound token only after tenant-scoped lookup", async () => {
    const repository = repositoryReturning(target);
    const issueToken = vi.fn().mockResolvedValue({
      token: "short-lived-token",
      expiresAt: new Date("2026-07-30T08:01:00.000Z"),
    });

    const issued = await issueAdminConversationStreamToken(
      principal,
      target.conversationId,
      { repository, issueToken },
    );

    expect(repository.findTarget).toHaveBeenCalledWith(
      principal.tenantId,
      target.conversationId,
    );
    expect(issueToken).toHaveBeenCalledWith({
      administratorUserId: principal.userId,
      tenantId: principal.tenantId,
      conversationId: target.conversationId,
    });
    expect(repository.recordTokenIssued).toHaveBeenCalledWith(principal, target);
    expect(issued.token).toBe("short-lived-token");
  });

  it("does not issue or audit a token for an unavailable tenant target", async () => {
    const repository = repositoryReturning(null);
    const issueToken = vi.fn();

    await expect(
      issueAdminConversationStreamToken(principal, target.conversationId, {
        repository,
        issueToken,
      }),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND", status: 404 });
    expect(issueToken).not.toHaveBeenCalled();
    expect(repository.recordTokenIssued).not.toHaveBeenCalled();
  });

  it("resolves the session mapping from signed claims and audits viewing", async () => {
    const repository = repositoryReturning(target);
    const claims = verifiedClaims();

    await expect(
      authorizeAdminConversationStream(claims, repository),
    ).resolves.toEqual(target);
    expect(repository.findTarget).toHaveBeenCalledWith(
      claims.tenantId,
      claims.conversationId,
    );
    expect(repository.recordStreamViewed).toHaveBeenCalledWith(claims, target);
  });
});

function repositoryReturning(
  value: AdminStreamTarget | null,
): AdminStreamRepository {
  return {
    findTarget: vi.fn().mockResolvedValue(value),
    recordTokenIssued: vi.fn().mockResolvedValue(undefined),
    recordStreamViewed: vi.fn().mockResolvedValue(undefined),
  };
}

function verifiedClaims(): VerifiedEveAdminStreamToken {
  return {
    iss: "urn:baigong-agent",
    aud: "urn:baigong-agent:eve-admin-stream",
    sub: principal.userId,
    purpose: "eve-admin-stream",
    administratorUserId: principal.userId,
    tenantId: principal.tenantId,
    conversationId: target.conversationId,
    iat: 1,
    exp: 61,
    jti: "45bcd3e5-1912-4504-b088-77d22de67f03",
  };
}
