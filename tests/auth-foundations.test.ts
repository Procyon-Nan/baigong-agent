import { describe, expect, it } from "vitest";
import {
  normalizeLoginIdentifier,
  opaqueToken,
  sha256,
} from "@/src/server/auth/identifiers";
import {
  normalizeAllowedOrigin,
  normalizeAllowedOrigins,
} from "@/src/server/auth/origin";
import { hashPassword, verifyPassword } from "@/src/server/auth/password";
import { parseClientCredentials } from "@/src/server/integrations/credentials";

describe("P2 authentication foundations", () => {
  it("normalizes local login identifiers consistently", () => {
    expect(normalizeLoginIdentifier("  Alice.Example  ")).toBe("alice.example");
    expect(normalizeLoginIdentifier("  Alice@Example.COM  ")).toBe(
      "alice@example.com",
    );
  });

  it("hashes passwords with Argon2id and verifies without exposing the password", async () => {
    const password = "a sufficiently long password";
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toContain(password);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(
      verifyPassword(passwordHash, "wrong password value"),
    ).resolves.toBe(false);
  });

  it("generates opaque tokens and stable non-reversible digests", () => {
    const first = opaqueToken();
    const second = opaqueToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(sha256(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256(first)).toBe(sha256(first));
  });

  it("accepts exact secure origins and only explicit localhost origins in development", () => {
    expect(normalizeAllowedOrigin("https://host.example.com", true)).toBe(
      "https://host.example.com",
    );
    expect(normalizeAllowedOrigin("http://localhost:4100", false)).toBe(
      "http://localhost:4100",
    );
    expect(() =>
      normalizeAllowedOrigin("http://host.example.com", true),
    ).toThrow();
    expect(() =>
      normalizeAllowedOrigin("https://*.example.com", true),
    ).toThrow();
    expect(() =>
      normalizeAllowedOrigin("https://host.example.com/path", true),
    ).toThrow();
    expect(
      normalizeAllowedOrigins(
        ["https://b.example", "https://a.example", "https://a.example"],
        true,
      ),
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it("parses client credentials without accepting incomplete values", () => {
    const headers = new Headers({
      authorization: `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    });
    const request = new Request("https://agent.example/api/embed/tickets", {
      headers,
    });
    expect(parseClientCredentials(request)).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    expect(() => parseClientCredentials(new Request(request.url))).toThrow();
  });
});
