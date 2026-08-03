import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminEventStreamAuthenticationError,
  parseAdminRawEvent,
  readAdminEventStream,
} from "@/app/components/chat/admin-event-stream";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("administrator event stream client", () => {
  it("parses the event type and durable event time without changing raw data", () => {
    const raw = {
      type: "turn.started",
      meta: { at: "2026-07-30T08:00:00.000Z" },
      data: { turnId: "turn-1", sequence: 0 },
    };

    expect(parseAdminRawEvent(JSON.stringify(raw), 3)).toEqual({
      index: 3,
      type: "turn.started",
      at: "2026-07-30T08:00:00.000Z",
      raw,
    });
    expect(parseAdminRawEvent("not-json", 4)).toBeNull();
  });

  it("keeps the token out of the URL and advances the absolute raw cursor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          token: "short-lived-token",
          expiresAt: "2026-07-30T08:01:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            '{"type":"turn.started","meta":{"at":"2026-07-30T08:00:00.000Z"}}',
            "invalid-json",
            '{"type":"turn.completed","meta":{"at":"2026-07-30T08:00:01.000Z"}}',
            "",
          ].join("\n"),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const events: number[] = [];

    const nextIndex = await readAdminEventStream({
      conversationId: "828e284a-3397-4663-bc4b-f6eddfae57d1",
      startIndex: 4,
      signal: new AbortController().signal,
      onEvents: (incoming) => {
        events.push(...incoming.map((event) => event.index));
      },
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/admin/conversations/828e284a-3397-4663-bc4b-f6eddfae57d1/stream-token",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/eve/v1/admin/stream?startIndex=4",
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      authorization: "Bearer short-lived-token",
    });
    expect(events).toEqual([4, 6]);
    expect(nextIndex).toBe(7);
  });

  it("reissues a short-lived stream token instead of ending the administrator login", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            token: "expired-before-connect",
            expiresAt: "2026-07-30T08:01:00.000Z",
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 401 })),
    );

    const attempt = readAdminEventStream({
      conversationId: "828e284a-3397-4663-bc4b-f6eddfae57d1",
      startIndex: 0,
      signal: new AbortController().signal,
      onEvents: vi.fn(),
    });

    await expect(attempt).rejects.toThrow("管理员事件流令牌已失效。");
  });

  it("ends the administrator session when the BFF rejects token issuance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 })),
    );

    await expect(
      readAdminEventStream({
        conversationId: "828e284a-3397-4663-bc4b-f6eddfae57d1",
        startIndex: 0,
        signal: new AbortController().signal,
        onEvents: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(AdminEventStreamAuthenticationError);
  });
});
