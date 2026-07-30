import "dotenv/config";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  isAdminPrincipal,
  type AdminPrincipal,
  type AuthenticatedPrincipal,
} from "@/src/server/auth/principal";
import {
  cleanupP2TestContext,
  configureP2TestDatabase,
  createP2TestContext,
  type P2TestContext,
} from "./support/p2-test-database";

configureP2TestDatabase();

const contexts: P2TestContext[] = [];

describe("P2 PostgreSQL integration", () => {
  beforeAll(async () => {
    const { pingDatabase } = await import("@/src/server/db/client");
    await pingDatabase();
  });

  afterEach(async () => {
    for (const context of contexts.splice(0)) {
      await cleanupP2TestContext(context);
      const { getDatabase } = await import("@/src/server/db/client");
      const { eq } = await import("drizzle-orm");
      const { tenants } = await import("@/src/server/db/schema");
      const rows = await getDatabase()
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, context.tenantId));
      expect(rows).toHaveLength(0);
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/src/server/db/client");
    await closeDatabase();
  });

  it("revokes stale local sessions after password, role, reset, and status changes", async () => {
    const context = await testContext("local-sessions");
    const actor = await loginAdministrator(context);
    const users = await import("@/src/server/users/service");
    const { resolvePrincipal } = await import("@/src/server/auth/principal");

    const managed = await users.createLocalUser({
      username: `user-${context.suffix}`,
      email: `user-${context.suffix}@example.com`,
      displayName: "P2 Managed User",
      role: "USER",
      actor,
    });
    const firstCookie = await login(
      context,
      managed.user.username!,
      managed.temporaryPassword,
      "192.0.2.11",
    );
    const secondCookie = await login(
      context,
      managed.user.username!,
      managed.temporaryPassword,
      "192.0.2.12",
    );
    const firstPrincipal = await resolvePrincipal(
      new Headers({ cookie: firstCookie }),
    );
    expect(firstPrincipal).toBeTruthy();

    const permanentPassword = `P2 permanent ${context.suffix} password`;
    await users.changeOwnPassword(
      firstPrincipal!,
      managed.temporaryPassword,
      permanentPassword,
    );
    await expect(
      resolvePrincipal(new Headers({ cookie: secondCookie })),
    ).resolves.toBeNull();
    await expect(
      resolvePrincipal(new Headers({ cookie: firstCookie })),
    ).resolves.toMatchObject({ mustChangePassword: false });

    await users.updateManagedUser(actor, managed.user.id, { role: "ADMIN" });
    await expect(
      resolvePrincipal(new Headers({ cookie: firstCookie })),
    ).resolves.toBeNull();

    const roleCookie = await login(
      context,
      managed.user.username!,
      permanentPassword,
      "192.0.2.13",
    );
    const resetPassword = await users.resetManagedUserPassword(
      actor,
      managed.user.id,
    );
    await expect(
      resolvePrincipal(new Headers({ cookie: roleCookie })),
    ).resolves.toBeNull();

    const statusCookie = await login(
      context,
      managed.user.username!,
      resetPassword,
      "192.0.2.14",
    );
    await users.updateManagedUser(actor, managed.user.id, {
      status: "DISABLED",
    });
    await expect(
      resolvePrincipal(new Headers({ cookie: statusCookie })),
    ).resolves.toBeNull();
  }, 30_000);

  it("serializes concurrent removal of the final two active administrators", async () => {
    const context = await testContext("admin-race");
    const firstAdministrator = await loginAdministrator(context);
    const users = await import("@/src/server/users/service");
    const { resolvePrincipal } = await import(
      "@/src/server/auth/principal"
    );

    const second = await users.createLocalUser({
      username: `second-${context.suffix}`,
      email: `second-${context.suffix}@example.com`,
      displayName: "Second P2 Administrator",
      role: "ADMIN",
      actor: firstAdministrator,
    });
    const secondCookie = await login(
      context,
      second.user.username!,
      second.temporaryPassword,
      "192.0.2.31",
    );
    let secondAdministrator = await resolvePrincipal(
      new Headers({ cookie: secondCookie }),
    );
    expect(secondAdministrator).toBeTruthy();
    await users.changeOwnPassword(
      secondAdministrator!,
      second.temporaryPassword,
      `P2 second ${context.suffix} password`,
    );
    secondAdministrator = await resolvePrincipal(
      new Headers({ cookie: secondCookie }),
    );
    expect(secondAdministrator).toBeTruthy();
    const secondActor = requireTestAdministrator(secondAdministrator);

    const results = await Promise.allSettled([
      users.updateManagedUser(firstAdministrator, second.user.id, {
        status: "DISABLED",
      }),
      users.updateManagedUser(
        secondActor,
        firstAdministrator.userId,
        { role: "USER" },
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: "LAST_ACTIVE_ADMINISTRATOR",
    });
  }, 30_000);

  it("keeps an origin-mismatched ticket consumable and rejects expired tickets", async () => {
    const context = await testContext("ticket-rules");
    const actor = await loginAdministrator(context);
    const integrations = await import("@/src/server/integrations/service");
    const { getDatabase } = await import("@/src/server/db/client");
    const { embeddedTickets } = await import("@/src/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const { sha256 } = await import("@/src/server/auth/identifiers");
    const client = await integrations.createEmbeddedClient(actor, {
      name: `P2 Host ${context.suffix}`,
      allowedOrigins: ["http://localhost:4100"],
    });

    const originTicket = await issueTicket(context, client, "origin-user");
    await expect(
      integrations.exchangeEmbeddedTicket({
        ticket: originTicket.ticket,
        origin: "http://localhost:4200",
        previousPrincipal: null,
      }),
    ).rejects.toMatchObject({ code: "INVALID_EMBEDDED_TICKET" });
    await expect(
      integrations.exchangeEmbeddedTicket({
        ticket: originTicket.ticket,
        origin: "http://localhost:4100",
        previousPrincipal: null,
      }),
    ).resolves.toMatchObject({ token: expect.any(String) });

    const expiredTicket = await issueTicket(context, client, "expired-user");
    await getDatabase()
      .update(embeddedTickets)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(embeddedTickets.ticketDigest, sha256(expiredTicket.ticket)));
    await expect(
      integrations.exchangeEmbeddedTicket({
        ticket: expiredTicket.ticket,
        origin: "http://localhost:4100",
        previousPrincipal: null,
      }),
    ).rejects.toMatchObject({ code: "INVALID_EMBEDDED_TICKET" });
  }, 30_000);

  it("rotates embedded sessions, preserves omitted profile fields, and revokes on disable", async () => {
    const context = await testContext("embedded-session");
    const actor = await loginAdministrator(context);
    const integrations = await import("@/src/server/integrations/service");
    const users = await import("@/src/server/users/service");
    const { resolvePrincipal } = await import("@/src/server/auth/principal");
    const client = await integrations.createEmbeddedClient(actor, {
      name: `P2 Host ${context.suffix}`,
      allowedOrigins: ["http://localhost:4100"],
    });

    const firstTicket = await issueTicket(context, client, "embedded-user", {
      displayName: "P2 Embedded User",
      displayEmail: `embedded-${context.suffix}@example.com`,
    });
    const firstSession = await integrations.exchangeEmbeddedTicket({
      ticket: firstTicket.ticket,
      origin: "http://localhost:4100",
      previousPrincipal: null,
    });
    const firstPrincipal = await resolvePrincipal(
      new Headers({ authorization: `Bearer ${firstSession.token}` }),
    );
    expect(firstPrincipal).toMatchObject({ source: "EMBEDDED", role: "USER" });

    const renewalTicket = await issueTicket(
      context,
      client,
      "embedded-user",
    );
    const renewed = await integrations.exchangeEmbeddedTicket({
      ticket: renewalTicket.ticket,
      origin: "http://localhost:4100",
      previousPrincipal: firstPrincipal,
    });
    await expect(
      resolvePrincipal(
        new Headers({ authorization: `Bearer ${firstSession.token}` }),
      ),
    ).resolves.toBeNull();

    const managedUsers = await users.listUsers(actor);
    expect(
      managedUsers.find((user) => user.id === renewed.principal.userId),
    ).toMatchObject({
      username: null,
      displayName: "P2 Embedded User",
      email: `embedded-${context.suffix}@example.com`,
    });

    await integrations.updateEmbeddedClient(actor, client.client.id, {
      status: "DISABLED",
    });
    await expect(
      resolvePrincipal(
        new Headers({ authorization: `Bearer ${renewed.token}` }),
      ),
    ).resolves.toBeNull();
  }, 30_000);

  it("persists source and identifier login limits", async () => {
    const context = await testContext("rate-limits");
    const protection = await import("@/src/server/auth/login-protection");
    const source = `source-${context.suffix}`;
    const identifier = `identifier-${context.suffix}`;
    const now = new Date();
    context.loginSources.add(source);
    context.loginIdentifiers.add(identifier);

    await protection.consumeLoginSourceAttempt(source, now);
    await protection.consumeLoginSourceAttempt(source, now);
    await protection.consumeLoginSourceAttempt(source, now);
    await expect(
      protection.consumeLoginSourceAttempt(source, now),
    ).rejects.toMatchObject({ code: "LOGIN_RATE_LIMITED" });

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

async function testContext(label: string): Promise<P2TestContext> {
  const context = await createP2TestContext(label);
  contexts.push(context);
  return context;
}

async function loginAdministrator(
  context: P2TestContext,
): Promise<AdminPrincipal> {
  const { resolvePrincipal } = await import(
    "@/src/server/auth/principal"
  );
  const cookie = await login(
    context,
    context.administratorUsername,
    context.administratorPassword,
    `198.51.100.${contexts.length + 10}`,
  );
  const principal = await resolvePrincipal(new Headers({ cookie }));
  expect(principal).toBeTruthy();
  return requireTestAdministrator(principal);
}

function requireTestAdministrator(
  principal: AuthenticatedPrincipal | null,
): AdminPrincipal {
  if (!principal || !isAdminPrincipal(principal)) {
    throw new Error("Expected a local administrator principal.");
  }
  return principal;
}

async function login(
  context: P2TestContext,
  identifier: string,
  password: string,
  source: string,
): Promise<string> {
  const { loginWithIdentifier } = await import(
    "@/src/server/auth/local-login"
  );
  context.loginSources.add(source);
  context.loginIdentifiers.add(identifier);
  const request = new Request("http://localhost:3000/api/auth/local-login", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-real-ip": source,
    },
  });
  const response = await loginWithIdentifier(request, identifier, password);
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toBeTruthy();
  return cookie!;
}

async function issueTicket(
  context: P2TestContext,
  client: Awaited<
    ReturnType<
      typeof import("@/src/server/integrations/service").createEmbeddedClient
    >
  >,
  externalUserId: string,
  profile: { readonly displayName?: string; readonly displayEmail?: string } = {},
) {
  const { issueEmbeddedTicket } = await import(
    "@/src/server/integrations/service"
  );
  const source = `ticket-${externalUserId}-${context.suffix}`;
  context.loginSources.add(`embedded-client:${source}`);
  return issueEmbeddedTicket({
    requestSource: source,
    clientId: client.client.clientId,
    clientSecret: client.clientSecret,
    externalUserId,
    origin: "http://localhost:4100",
    ...profile,
  });
}
