import { describe, expect, it, vi } from "vitest";
import { createBffServiceAuth } from "@/agent/channels/eve";
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
  agentConfigVersionId: "87777777-7777-4777-8777-777777777777",
};

describe("eve BFF service authentication", () => {
  it("rejects requests without a bearer token by exhausting the auth walk", async () => {
    const verify = vi.fn();
    const auth = createBffServiceAuth({ verifyToken: verify });

    await expect(auth(new Request("http://localhost/eve/v1/info"))).resolves.toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("projects only verified service claims into the eve principal", async () => {
    const authorizeRequest = vi.fn().mockResolvedValue(true);
    const auth = createBffServiceAuth({
      verifyToken: vi.fn().mockResolvedValue(claims),
      authorizeRequest,
    });

    await expect(
      auth(
        new Request("http://localhost/eve/v1/info", {
          headers: { authorization: "Bearer signed-service-token" },
        }),
      ),
    ).resolves.toEqual({
      attributes: {
        tenantId: claims.tenantId,
        role: claims.role,
        source: claims.source,
        conversationId: claims.conversationId,
        turnId: claims.turnId,
        modelConfigVersionId: claims.modelConfigVersionId,
        agentConfigVersionId: claims.agentConfigVersionId,
      },
      authenticator: "baigong-bff",
      issuer: claims.iss,
      principalId: claims.userId,
      principalType: "user",
      subject: claims.sub,
    });
    expect(authorizeRequest).toHaveBeenCalledWith(claims, expect.any(Request));
  });

  it("turns every failed verification into a structured authentication rejection", async () => {
    const auth = createBffServiceAuth({
      verifyToken: vi.fn().mockRejectedValue(new Error("invalid signature")),
    });

    await expect(
      auth(
        new Request("http://localhost/eve/v1/info", {
          headers: { authorization: "Bearer invalid" },
        }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ status: 401 }),
    });
  });

  it("rejects a valid token after its database authority is revoked", async () => {
    const auth = createBffServiceAuth({
      verifyToken: vi.fn().mockResolvedValue(claims),
      authorizeRequest: vi.fn().mockResolvedValue(false),
    });

    await expect(
      auth(
        new Request("http://localhost/eve/v1/info", {
          headers: { authorization: "Bearer revoked" },
        }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ status: 401 }),
    });
  });
});
