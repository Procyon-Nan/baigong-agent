import { describe, expect, it, vi } from "vitest";
import { createAdminStreamChannel } from "@/agent/channels/admin-stream";
import type { VerifiedEveAdminStreamToken } from "@/src/server/eve/tokens";
import { ApplicationError } from "@/src/server/errors";

const claims: VerifiedEveAdminStreamToken = {
  iss: "urn:baigong-agent",
  aud: "urn:baigong-agent:eve-admin-stream",
  sub: "admin-1",
  purpose: "eve-admin-stream",
  administratorUserId: "admin-1",
  tenantId: "239f1821-ca26-41ba-a752-fb98fb4918b1",
  conversationId: "828e284a-3397-4663-bc4b-f6eddfae57d1",
  iat: 1,
  exp: 61,
  jti: "45bcd3e5-1912-4504-b088-77d22de67f03",
};

describe("administrator raw event channel", () => {
  it("rejects missing and invalid bearer tokens", async () => {
    const verifyToken = vi.fn().mockRejectedValue(
      new ApplicationError({
        code: "INVALID_EVE_TOKEN",
        message: "invalid",
        status: 401,
      }),
    );
    const authorizeStream = vi.fn();
    const handler = routeHandler(
      createAdminStreamChannel({ verifyToken, authorizeStream }),
    );

    const missing = await handler(
      new Request("http://localhost/eve/v1/admin/stream"),
      routeArgs(),
    );
    const invalid = await handler(
      new Request("http://localhost/eve/v1/admin/stream", {
        headers: { authorization: "Bearer invalid-token" },
      }),
      routeArgs(),
    );

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(authorizeStream).not.toHaveBeenCalled();
  });

  it("does not hide signing-key failures as invalid caller tokens", async () => {
    const operationalFailure = new ApplicationError({
      code: "INVALID_SECRET_FILE",
      message: "unavailable",
      status: 503,
    });
    const handler = routeHandler(
      createAdminStreamChannel({
        verifyToken: vi.fn().mockRejectedValue(operationalFailure),
        authorizeStream: vi.fn(),
      }),
    );

    await expect(
      handler(authorizedRequest(), routeArgs()),
    ).rejects.toBe(operationalFailure);
  });

  it("rejects a non-absolute stream cursor before resolving a session", async () => {
    const authorizeStream = vi.fn();
    const handler = routeHandler(
      createAdminStreamChannel({
        verifyToken: vi.fn().mockResolvedValue(claims),
        authorizeStream,
      }),
    );
    const response = await handler(
      authorizedRequest("?startIndex=-1"),
      routeArgs(),
    );

    expect(response.status).toBe(400);
    expect(authorizeStream).not.toHaveBeenCalled();
  });

  it("maps signed claims to one eve session and returns its raw NDJSON", async () => {
    const authorizeStream = vi.fn().mockResolvedValue({
      conversationId: claims.conversationId,
      eveSessionId: "wrun_01ARYZ6S41TSV4RRFFQ69G5FAV",
      ownerUserId: "user-1",
    });
    const getEventStream = vi.fn().mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "session.started",
            data: { sessionId: "eve-session" },
          });
          controller.close();
        },
      }),
    );
    const getSession = vi.fn().mockReturnValue({ getEventStream });
    const handler = routeHandler(
      createAdminStreamChannel({
        verifyToken: vi.fn().mockResolvedValue(claims),
        authorizeStream,
      }),
    );

    const response = await handler(
      authorizedRequest("?startIndex=7"),
      routeArgs(getSession),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    await expect(response.text()).resolves.toBe(
      '{"type":"session.started","data":{"sessionId":"eve-session"}}\n',
    );
    expect(authorizeStream).toHaveBeenCalledWith({
      administratorUserId: claims.administratorUserId,
      tenantId: claims.tenantId,
      conversationId: claims.conversationId,
    });
    expect(getSession).toHaveBeenCalledWith(
      "wrun_01ARYZ6S41TSV4RRFFQ69G5FAV",
    );
    expect(getEventStream).toHaveBeenCalledWith({ startIndex: 7 });
  });
});

function authorizedRequest(query = ""): Request {
  return new Request(`http://localhost/eve/v1/admin/stream${query}`, {
    headers: { authorization: "Bearer valid-token" },
  });
}

function routeHandler(channel: ReturnType<typeof createAdminStreamChannel>) {
  const route = channel.routes[0];
  if (!route || route.transport === "websocket") {
    throw new Error("Administrator stream HTTP route is missing.");
  }
  return route.handler;
}

function routeArgs(getSession: ReturnType<typeof vi.fn> = vi.fn()) {
  return {
    send: vi.fn(),
    resolveActiveSession: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    getSession,
    receive: vi.fn(),
    params: {},
    waitUntil: vi.fn(),
    requestIp: "127.0.0.1",
  } as never;
}
