import { describe, expect, it } from "vitest";
import { parseServiceSessionIdentity } from "@/src/server/conversations/session-mapping";

const identity = {
  authenticator: "baigong-bff",
  principalId: "user-1",
  attributes: {
    tenantId: "239f1821-ca26-41ba-a752-fb98fb4918b1",
    role: "USER",
    source: "LOCAL",
    conversationId: "828e284a-3397-4663-bc4b-f6eddfae57d1",
    turnId: "10492458-213f-43d9-aa4e-f650eaa3f1f4",
    modelConfigVersionId: "7dd2c78f-1758-46a3-862a-753e845813c7",
  },
};

describe("eve session mapping identity", () => {
  it("accepts the exact BFF projection", () => {
    expect(parseServiceSessionIdentity(identity)).toEqual(identity);
  });

  it("rejects identities that are not the BFF projection", () => {
    expect(() =>
      parseServiceSessionIdentity({ ...identity, authenticator: "local-dev" }),
    ).toThrow();
    expect(() =>
      parseServiceSessionIdentity({
        ...identity,
        attributes: { ...identity.attributes, unexpected: "value" },
      }),
    ).toThrow();
  });
});
