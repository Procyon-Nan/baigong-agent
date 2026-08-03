import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVE_ADMIN_STREAM_JWT_AUDIENCE,
  EVE_JWT_ISSUER,
  EVE_SERVICE_JWT_AUDIENCE,
  EVE_TOKEN_LIFETIME_SECONDS,
  issueEveAdminStreamToken,
  issueEveServiceToken,
  verifyEveAdminStreamToken,
  verifyEveServiceToken,
} from "@/src/server/eve/tokens";
import {
  loadOrCreateProjectSecret,
  projectSecrets,
} from "@/src/server/config/data-directory";

const temporaryDirectories: string[] = [];
const now = new Date("2026-07-30T08:00:00.000Z");
const serviceClaims = {
  userId: "user-1",
  tenantId: "239f1821-ca26-41ba-a752-fb98fb4918b1",
  role: "USER" as const,
  source: "LOCAL" as const,
  conversationId: "828e284a-3397-4663-bc4b-f6eddfae57d1",
  turnId: "10492458-213f-43d9-aa4e-f650eaa3f1f4",
  modelConfigVersionId: "7dd2c78f-1758-46a3-862a-753e845813c7",
};
const adminClaims = {
  administratorUserId: "admin-1",
  tenantId: serviceClaims.tenantId,
  conversationId: serviceClaims.conversationId,
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("eve JWTs", () => {
  it("issues a 60-second service token from the persistent project key", async () => {
    const options = await tokenOptions();
    const issued = await issueEveServiceToken(serviceClaims, options);
    const verified = await verifyEveServiceToken(issued.token, options);

    expect(issued.expiresAt.getTime() - now.getTime()).toBe(
      EVE_TOKEN_LIFETIME_SECONDS * 1_000,
    );
    expect(verified).toMatchObject({
      ...serviceClaims,
      iss: EVE_JWT_ISSUER,
      aud: EVE_SERVICE_JWT_AUDIENCE,
      sub: serviceClaims.userId,
      purpose: "eve-service",
    });
    expect(verified.exp - verified.iat).toBe(EVE_TOKEN_LIFETIME_SECONDS);
  });

  it("keeps service and administrator-stream tokens non-interchangeable", async () => {
    const options = await tokenOptions();
    const service = await issueEveServiceToken(serviceClaims, options);
    const admin = await issueEveAdminStreamToken(adminClaims, options);

    await expect(
      verifyEveAdminStreamToken(service.token, options),
    ).rejects.toMatchObject({ code: "INVALID_EVE_TOKEN", status: 401 });
    await expect(
      verifyEveServiceToken(admin.token, options),
    ).rejects.toMatchObject({ code: "INVALID_EVE_TOKEN", status: 401 });
    await expect(
      verifyEveAdminStreamToken(admin.token, options),
    ).resolves.toMatchObject({
      ...adminClaims,
      aud: EVE_ADMIN_STREAM_JWT_AUDIENCE,
      purpose: "eve-admin-stream",
    });
  });

  it("rejects tampering, expiration, and a different project key", async () => {
    const options = await tokenOptions();
    const otherOptions = await tokenOptions();
    const issued = await issueEveServiceToken(serviceClaims, options);
    const tokenParts = issued.token.split(".");
    const signature = tokenParts[2];
    if (!signature) throw new Error("JWT signature is missing.");
    tokenParts[2] = `${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
    const tampered = tokenParts.join(".");

    await expect(
      verifyEveServiceToken(tampered, options),
    ).rejects.toMatchObject({ code: "INVALID_EVE_TOKEN" });
    await expect(
      verifyEveServiceToken(issued.token, {
        ...options,
        now: new Date(issued.expiresAt.getTime() + 1_000),
      }),
    ).rejects.toMatchObject({ code: "INVALID_EVE_TOKEN" });
    await expect(
      verifyEveServiceToken(issued.token, otherOptions),
    ).rejects.toMatchObject({ code: "INVALID_EVE_TOKEN" });
  });

  it("rejects signed tokens with extra claims", async () => {
    const options = await tokenOptions();
    const key = await loadOrCreateProjectSecret(
      projectSecrets.jwtSigning.fileName,
      projectSecrets.jwtSigning.length,
      options.source,
      options.projectRoot,
    );
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    const token = await new SignJWT({
      ...serviceClaims,
      purpose: "eve-service",
      unexpected: "must-not-pass",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(EVE_JWT_ISSUER)
      .setAudience(EVE_SERVICE_JWT_AUDIENCE)
      .setSubject(serviceClaims.userId)
      .setJti("45bcd3e5-1912-4504-b088-77d22de67f03")
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + EVE_TOKEN_LIFETIME_SECONDS)
      .sign(key);

    await expect(
      verifyEveServiceToken(token, options),
    ).rejects.toMatchObject({ code: "INVALID_EVE_TOKEN" });
  });

  it("rejects a wrong purpose, non-fixed lifetime, and unexpected header", async () => {
    const options = await tokenOptions();
    const key = await loadOrCreateProjectSecret(
      projectSecrets.jwtSigning.fileName,
      projectSecrets.jwtSigning.length,
      options.source,
      options.projectRoot,
    );
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    const payload = { ...serviceClaims, purpose: "eve-service" };
    const wrongPurpose = await new SignJWT({
      ...serviceClaims,
      purpose: "eve-admin-stream",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(EVE_JWT_ISSUER)
      .setAudience(EVE_SERVICE_JWT_AUDIENCE)
      .setSubject(serviceClaims.userId)
      .setJti("61cd7d9b-a6e7-49a5-b350-a60d1033e102")
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + EVE_TOKEN_LIFETIME_SECONDS)
      .sign(key);
    const wrongAdminPurpose = await new SignJWT({
      ...adminClaims,
      purpose: "eve-service",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(EVE_JWT_ISSUER)
      .setAudience(EVE_ADMIN_STREAM_JWT_AUDIENCE)
      .setSubject(adminClaims.administratorUserId)
      .setJti("9e190f51-fe74-40ff-bf98-b06ae83e0c57")
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + EVE_TOKEN_LIFETIME_SECONDS)
      .sign(key);
    const longLived = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(EVE_JWT_ISSUER)
      .setAudience(EVE_SERVICE_JWT_AUDIENCE)
      .setSubject(serviceClaims.userId)
      .setJti("da64755d-f631-4b2e-a251-2acdc98bdb04")
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + EVE_TOKEN_LIFETIME_SECONDS + 1)
      .sign(key);
    const unexpectedHeader = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: "unexpected" })
      .setIssuer(EVE_JWT_ISSUER)
      .setAudience(EVE_SERVICE_JWT_AUDIENCE)
      .setSubject(serviceClaims.userId)
      .setJti("150cba46-cd0c-447a-8402-214ce50952b4")
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + EVE_TOKEN_LIFETIME_SECONDS)
      .sign(key);

    await expect(
      verifyEveServiceToken(wrongPurpose, options),
    ).rejects.toMatchObject({ code: "INVALID_EVE_TOKEN" });
    await expect(
      verifyEveAdminStreamToken(wrongAdminPurpose, options),
    ).rejects.toMatchObject({ code: "INVALID_EVE_TOKEN" });
    await expect(
      verifyEveServiceToken(longLived, options),
    ).rejects.toMatchObject({ code: "INVALID_EVE_TOKEN" });
    await expect(
      verifyEveServiceToken(unexpectedHeader, options),
    ).rejects.toMatchObject({ code: "INVALID_EVE_TOKEN" });
  });

  it("does not issue an administrator role for an embedded identity", async () => {
    const options = await tokenOptions();

    await expect(
      issueEveServiceToken(
        { ...serviceClaims, role: "ADMIN", source: "EMBEDDED" },
        options,
      ),
    ).rejects.toBeDefined();
  });
});

async function tokenOptions(): Promise<{
  readonly source: { readonly BAIGONG_DATA_DIR: string };
  readonly projectRoot: string;
  readonly now: Date;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "baigong-agent-jwt-"));
  temporaryDirectories.push(projectRoot);
  return {
    source: { BAIGONG_DATA_DIR: "state" },
    projectRoot,
    now,
  };
}
