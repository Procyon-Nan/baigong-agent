import { afterAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.P2_TEST_DATABASE_URL;
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.BAIGONG_DATA_DIR ??= "/tmp/baigong-agent-p2-tests";
  process.env.BAIGONG_APP_ORIGIN ??= "http://localhost:3000";
}

describe.skipIf(!databaseUrl)("P2 PostgreSQL integration", () => {
  afterAll(async () => {
    const { closeDatabase } = await import("@/src/server/db/client");
    await closeDatabase();
  });

  it("enforces local and embedded identity lifecycles", async () => {
    const users = await import("@/src/server/users/service");
    const { loginWithIdentifier } = await import(
      "@/src/server/auth/local-login"
    );
    const { resolvePrincipal } = await import("@/src/server/auth/principal");
    const integrations = await import("@/src/server/integrations/service");

    const suffix = crypto.randomUUID().slice(0, 8);
    const sharedEmail = `shared-${suffix}@example.com`;
    const administrator = await users.createLocalUser({
      username: `admin-${suffix}`,
      email: sharedEmail,
      displayName: "P2 Test Administrator",
      role: "ADMIN",
    });
    const loginRequest = new Request(
      "http://localhost:3000/api/auth/local-login",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "x-real-ip": "192.0.2.10",
        },
      },
    );
    const loginResponse = await loginWithIdentifier(
      loginRequest,
      administrator.user.username!,
      administrator.temporaryPassword,
    );
    const cookie = loginResponse.headers.get("set-cookie");
    expect(cookie).toBeTruthy();
    let principal = await resolvePrincipal(new Headers({ cookie: cookie! }));
    expect(principal).toMatchObject({
      role: "ADMIN",
      source: "LOCAL",
      mustChangePassword: true,
    });

    await users.changeOwnPassword(
      principal!,
      administrator.temporaryPassword,
      "a new database test password",
    );
    principal = await resolvePrincipal(new Headers({ cookie: cookie! }));
    expect(principal?.mustChangePassword).toBe(false);

    const localUser = await users.createLocalUser({
      username: `user-${suffix}`,
      email: `local-${suffix}@example.com`,
      displayName: "P2 Local User",
      role: "USER",
      actor: principal!,
    });
    await users.updateManagedUser(principal!, localUser.user.id, {
      status: "DISABLED",
    });
    await users.updateManagedUser(principal!, localUser.user.id, {
      status: "ACTIVE",
    });
    await expect(
      users.updateManagedUser(principal!, principal!.userId, {
        status: "DISABLED",
      }),
    ).rejects.toMatchObject({ code: "LAST_ACTIVE_ADMINISTRATOR" });

    const createdClient = await integrations.createEmbeddedClient(principal!, {
      name: `P2 Host ${suffix}`,
      allowedOrigins: ["http://localhost:4100"],
    });
    const oldSecret = createdClient.clientSecret;
    const newSecret = await integrations.rotateEmbeddedClientSecret(
      principal!,
      createdClient.client.id,
    );
    await expect(
      integrations.issueEmbeddedTicket({
        requestSource: `old-secret-${suffix}`,
        clientId: createdClient.client.clientId,
        clientSecret: oldSecret,
        externalUserId: "external-user",
        origin: "http://localhost:4100",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CLIENT_CREDENTIALS" });

    const ticket = await integrations.issueEmbeddedTicket({
      requestSource: `host-${suffix}`,
      clientId: createdClient.client.clientId,
      clientSecret: newSecret,
      externalUserId: "external-user",
      origin: "http://localhost:4100",
      displayName: "P2 Embedded User",
      displayEmail: sharedEmail,
    });
    const exchanges = await Promise.allSettled([
      integrations.exchangeEmbeddedTicket({
        ticket: ticket.ticket,
        origin: "http://localhost:4100",
        previousPrincipal: null,
      }),
      integrations.exchangeEmbeddedTicket({
        ticket: ticket.ticket,
        origin: "http://localhost:4100",
        previousPrincipal: null,
      }),
    ]);
    expect(
      exchanges.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      exchanges.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const firstSession = exchanges.find(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof integrations.exchangeEmbeddedTicket>>
      > => result.status === "fulfilled",
    )!.value;
    const embeddedPrincipal = await resolvePrincipal(
      new Headers({ authorization: `Bearer ${firstSession.token}` }),
    );
    expect(embeddedPrincipal).toMatchObject({
      role: "USER",
      source: "EMBEDDED",
    });

    const renewalTicket = await integrations.issueEmbeddedTicket({
      requestSource: `host-renew-${suffix}`,
      clientId: createdClient.client.clientId,
      clientSecret: newSecret,
      externalUserId: "external-user",
      origin: "http://localhost:4100",
      displayName: "P2 Embedded User",
      displayEmail: sharedEmail,
    });
    const renewedSession = await integrations.exchangeEmbeddedTicket({
      ticket: renewalTicket.ticket,
      origin: "http://localhost:4100",
      previousPrincipal: embeddedPrincipal,
    });
    await expect(
      resolvePrincipal(
        new Headers({ authorization: `Bearer ${firstSession.token}` }),
      ),
    ).resolves.toBeNull();
    await expect(
      resolvePrincipal(
        new Headers({ authorization: `Bearer ${renewedSession.token}` }),
      ),
    ).resolves.toMatchObject({ userId: embeddedPrincipal!.userId });

    const managedUsers = await users.listUsers(principal!.tenantId);
    expect(
      managedUsers.filter((user) => user.email === sharedEmail),
    ).toHaveLength(2);
    expect(
      managedUsers.find((user) => user.source === "EMBEDDED"),
    ).toMatchObject({
      username: null,
      role: "USER",
    });

    await integrations.updateEmbeddedClient(
      principal!,
      createdClient.client.id,
      {
        status: "DISABLED",
      },
    );
    await expect(
      resolvePrincipal(
        new Headers({ authorization: `Bearer ${renewedSession.token}` }),
      ),
    ).resolves.toBeNull();
  }, 30_000);

  it("persists source and identifier login limits", async () => {
    const protection = await import("@/src/server/auth/login-protection");
    const suffix = crypto.randomUUID();
    const now = new Date();
    await protection.consumeLoginSourceAttempt(`source-${suffix}`, now);
    await protection.consumeLoginSourceAttempt(`source-${suffix}`, now);
    await protection.consumeLoginSourceAttempt(`source-${suffix}`, now);
    await expect(
      protection.consumeLoginSourceAttempt(`source-${suffix}`, now),
    ).rejects.toMatchObject({ code: "LOGIN_RATE_LIMITED" });

    const identifier = `identifier-${suffix}`;
    for (let attempt = 1; attempt <= 9; attempt += 1) {
      await expect(
        protection.recordLoginFailure(identifier, now),
      ).resolves.toBe(false);
    }
    await expect(protection.recordLoginFailure(identifier, now)).resolves.toBe(
      true,
    );
    await expect(
      protection.isLoginIdentifierRestricted(identifier, now),
    ).resolves.toBe(true);
    await protection.clearLoginFailures(identifier);
    await expect(
      protection.isLoginIdentifierRestricted(identifier, now),
    ).resolves.toBe(false);
  });
});
