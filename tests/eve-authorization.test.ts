import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/src/server/db/client";
import { authorizeEveServiceRequest } from "@/src/server/eve/authorization";
import type { VerifiedEveServiceToken } from "@/src/server/eve/tokens";

const claims: VerifiedEveServiceToken = {
  iss: "urn:baigong-agent",
  aud: "urn:baigong-agent:eve-service",
  sub: "user-1",
  purpose: "eve-service",
  iat: 1,
  exp: 61,
  jti: "fa241479-0d75-40be-a3e0-a884023c92c6",
  userId: "user-1",
  tenantId: "239f1821-ca26-41ba-a752-fb98fb4918b1",
  role: "USER",
  source: "LOCAL",
  conversationId: "828e284a-3397-4663-bc4b-f6eddfae57d1",
  turnId: "10492458-213f-43d9-aa4e-f650eaa3f1f4",
  modelConfigVersionId: "7dd2c78f-1758-46a3-862a-753e845813c7",
};

type AuthorizationRow = {
  readonly profileRole: "USER" | "ADMIN";
  readonly profileSource: "LOCAL" | "EMBEDDED";
  readonly profileStatus: "ACTIVE" | "DISABLED";
  readonly clientStatus: "ACTIVE" | "DISABLED" | "DELETED" | null;
  readonly conversationStatus: string;
  readonly activeTurnId: string | null;
  readonly eveSessionId: string | null;
};

const activeRow: AuthorizationRow = {
  profileRole: "USER",
  profileSource: "LOCAL",
  profileStatus: "ACTIVE",
  clientStatus: null,
  conversationStatus: "RUNNING",
  activeTurnId: claims.turnId,
  eveSessionId: "eve-session-1",
};

describe("eve service request database authorization", () => {
  it.each([
    ["POST", "/eve/v1/session", { conversationStatus: "STARTING", eveSessionId: null }],
    ["POST", "/eve/v1/session/eve-session-1", {}],
    ["GET", "/eve/v1/session/eve-session-1/stream", {}],
    ["GET", "/eve/v1/info", {}],
  ] as const)("allows the bound active request: %s %s", async (method, path, row) => {
    await expect(
      authorize(method, path, { ...activeRow, ...row }),
    ).resolves.toBe(true);
  });

  it.each([
    ["POST", "/eve/v1/session/another-session"],
    ["POST", "/eve/v1/session/eve-session-1/stream"],
    ["GET", "/eve/v1/session/eve-session-1/cancel"],
    ["POST", "/eve/v1/session/eve-session-1/unknown"],
    ["POST", "/eve/v1/session/%E0%A4%A"],
  ] as const)("rejects a mismatched route binding: %s %s", async (method, path) => {
    await expect(authorize(method, path, activeRow)).resolves.toBe(false);
  });

  it.each([
    ["disabled user", { profileStatus: "DISABLED" }],
    ["changed role", { profileRole: "ADMIN" }],
    ["changed identity source", { profileSource: "EMBEDDED" }],
  ] as const)("rejects ordinary routes for a revoked local identity: %s", async (_label, row) => {
    await expect(
      authorize("GET", "/eve/v1/info", { ...activeRow, ...row }),
    ).resolves.toBe(false);
    await expect(
      authorize("GET", "/eve/v1/session/eve-session-1/stream", {
        ...activeRow,
        ...row,
      }),
    ).resolves.toBe(false);
  });

  it("rejects ordinary routes after an embedded client is disabled", async () => {
    const embeddedClaims = { ...claims, source: "EMBEDDED" as const };
    const embeddedRow = {
      ...activeRow,
      profileSource: "EMBEDDED" as const,
      clientStatus: "DISABLED" as const,
    };

    await expect(
      authorize(
        "POST",
        "/eve/v1/session/eve-session-1",
        embeddedRow,
        embeddedClaims,
      ),
    ).resolves.toBe(false);
  });

  it.each([
    ["POST", "/eve/v1/session/eve-session-1/cancel"],
    ["GET", "/eve/v1/session/eve-session-1/stream"],
  ] as const)(
    "keeps only cancellation cleanup routes open after revocation: %s %s",
    async (method, path) => {
      const revoked = {
        ...activeRow,
        profileStatus: "DISABLED" as const,
        profileRole: "ADMIN" as const,
        conversationStatus: "CANCELLING",
      };
      await expect(authorize(method, path, revoked)).resolves.toBe(true);
      await expect(
        authorize("GET", "/eve/v1/info", revoked),
      ).resolves.toBe(false);
      await expect(
        authorize("POST", "/eve/v1/session/eve-session-1", revoked),
      ).resolves.toBe(false);
    },
  );

  it("rejects cancellation cleanup with a stale turn token", async () => {
    const cancelling = {
      ...activeRow,
      profileStatus: "DISABLED" as const,
      conversationStatus: "CANCELLING",
      activeTurnId: "new-active-turn",
    };

    await expect(
      authorize(
        "POST",
        "/eve/v1/session/eve-session-1/cancel",
        cancelling,
      ),
    ).resolves.toBe(false);
    await expect(
      authorize(
        "GET",
        "/eve/v1/session/eve-session-1/stream",
        cancelling,
      ),
    ).resolves.toBe(false);
  });

  it("requires the signed identity source on cancellation cleanup routes", async () => {
    await expect(
      authorize("POST", "/eve/v1/session/eve-session-1/cancel", {
        ...activeRow,
        profileSource: "EMBEDDED",
        profileStatus: "DISABLED",
        conversationStatus: "CANCELLING",
      }),
    ).resolves.toBe(false);
  });

  it("fails closed when the database mapping is absent", async () => {
    await expect(
      authorizeEveServiceRequest(
        claims,
        request("GET", "/eve/v1/info"),
        databaseReturning(null),
      ),
    ).resolves.toBe(false);
  });
});

function authorize(
  method: string,
  path: string,
  row: AuthorizationRow,
  tokenClaims: VerifiedEveServiceToken = claims,
): Promise<boolean> {
  return authorizeEveServiceRequest(
    tokenClaims,
    request(method, path),
    databaseReturning(row),
  );
}

function request(method: string, path: string): Request {
  return new Request(`http://localhost${path}`, { method });
}

function databaseReturning(row: AuthorizationRow | null): Database {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue(row ? [row] : []),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return {
    select: vi.fn().mockReturnValue(query),
  } as unknown as Database;
}
