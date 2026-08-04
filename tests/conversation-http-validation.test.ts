import { describe, expect, it } from "vitest";
import {
  P3_CONVERSATION_REQUEST_MAX_BYTES,
  P3_MESSAGE_MAX_CHARACTERS,
  createConversationMessageSchema,
  parseConversationHistoryQuery,
  parseConversationListQuery,
  submitConversationMessageSchema,
} from "@/src/server/http/p3-conversation-schemas";
import {
  decodeConversationHistoryCursor,
  decodeConversationListCursor,
  encodeConversationHistoryCursor,
  encodeConversationListCursor,
} from "@/src/server/conversations/conversation-cursors";
import { parseJsonBody } from "@/src/server/http/request";
import {
  parseAdminConversationDetailQuery,
  parseAdminConversationExecutionQuery,
  parseAdminConversationListQuery,
} from "@/src/server/http/p4-admin-conversation-schemas";
import {
  decodeAdminConversationActionCursor,
  decodeAdminConversationListCursor,
  encodeAdminConversationActionCursor,
  encodeAdminConversationListCursor,
} from "@/src/server/conversations/admin-conversation-cursors";

const requestId = "11111111-1111-4111-8111-111111111111";

describe("conversation request validation", () => {
  it("counts Unicode code points instead of UTF-16 code units", () => {
    const message = "😀".repeat(P3_MESSAGE_MAX_CHARACTERS);

    expect(
      submitConversationMessageSchema.safeParse({ message, requestId }).success,
    ).toBe(true);
    expect(
      submitConversationMessageSchema.safeParse({
        message: `${message}😀`,
        requestId,
      }).success,
    ).toBe(false);
  });

  it("rejects blank messages and unknown fields", () => {
    expect(
      submitConversationMessageSchema.safeParse({ message: "  \n", requestId })
        .success,
    ).toBe(false);
    expect(
      submitConversationMessageSchema.safeParse({
        message: "hello",
        requestId,
        model: "must-not-be-accepted",
      }).success,
    ).toBe(false);
  });

  it("allows retries only when continuing an existing conversation", () => {
    const retryOfTurnId = "22222222-2222-4222-8222-222222222222";
    const input = { message: "retry", requestId, retryOfTurnId };

    expect(submitConversationMessageSchema.safeParse(input).success).toBe(true);
    expect(createConversationMessageSchema.safeParse(input).success).toBe(
      false,
    );
    expect(
      submitConversationMessageSchema.safeParse({
        ...input,
        retryOfTurnId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("rejects an oversized declared request before reading the body", async () => {
    const request = new Request("http://localhost/api/conversations", {
      method: "POST",
      headers: {
        "content-length": String(P3_CONVERSATION_REQUEST_MAX_BYTES + 1),
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: "hello", requestId }),
    });

    await expect(
      parseJsonBody(request, submitConversationMessageSchema, {
        maxBytes: P3_CONVERSATION_REQUEST_MAX_BYTES,
      }),
    ).rejects.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
      status: 413,
    });
  });

  it("enforces the byte limit when Content-Length is absent", async () => {
    const request = new Request("http://localhost/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "a".repeat(P3_CONVERSATION_REQUEST_MAX_BYTES),
        requestId,
      }),
    });

    await expect(
      parseJsonBody(request, submitConversationMessageSchema, {
        maxBytes: P3_CONVERSATION_REQUEST_MAX_BYTES,
      }),
    ).rejects.toMatchObject({ code: "REQUEST_BODY_TOO_LARGE", status: 413 });
  });

  it("parses strict listing and history query parameters", () => {
    expect(
      parseConversationListQuery(
        new URLSearchParams("archived=true&cursor=abc"),
      ),
    ).toEqual({ archived: "true", cursor: "abc" });
    expect(parseConversationHistoryQuery(new URLSearchParams())).toEqual({});
    expect(() =>
      parseConversationListQuery(new URLSearchParams("unknown=value")),
    ).toThrowError();
    expect(() =>
      parseConversationListQuery(new URLSearchParams("cursor=a&cursor=b")),
    ).toThrowError();
  });

  it("rejects malformed or wrong-kind cursors", () => {
    const listCursor = encodeConversationListCursor({
      updatedAt: "2026-08-01T00:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(decodeConversationListCursor(listCursor).id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(() => decodeConversationListCursor("not-a-cursor")).toThrowError();
    const historyCursor = encodeConversationHistoryCursor({
      sequence: 1,
      id: "22222222-2222-4222-8222-222222222222",
    });
    expect(() => decodeConversationListCursor(historyCursor)).toThrowError();
  });

  it("parses strict administrator audit filters", () => {
    expect(
      parseAdminConversationListQuery(
        new URLSearchParams(
          "userId=user-1&source=LOCAL&status=WAITING&archived=active",
        ),
      ),
    ).toEqual({
      userId: "user-1",
      source: "LOCAL",
      status: "WAITING",
      archived: "active",
    });
    expect(
      parseAdminConversationListQuery(
        new URLSearchParams("userId=&source=&status=&archived=all"),
      ),
    ).toEqual({ archived: "all" });
    expect(() =>
      parseAdminConversationListQuery(new URLSearchParams("role=ADMIN")),
    ).toThrowError();
    expect(() =>
      parseAdminConversationDetailQuery(
        new URLSearchParams("cursor=a&cursor=b"),
      ),
    ).toThrowError();
    expect(
      parseAdminConversationExecutionQuery(new URLSearchParams()),
    ).toEqual({});
  });

  it("binds administrator list cursors to their filters", () => {
    const filterKey = JSON.stringify(["user-1", "LOCAL", "WAITING", "active"]);
    const cursor = encodeAdminConversationListCursor({
      updatedAt: "2026-08-04T00:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      filterKey,
    });
    expect(decodeAdminConversationListCursor(cursor, filterKey)?.id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(() =>
      decodeAdminConversationListCursor(cursor, "different-filter"),
    ).toThrowError();

    const actionCursor = encodeAdminConversationActionCursor({
      requestEveCursor: 12,
      id: "22222222-2222-4222-8222-222222222222",
    });
    expect(decodeAdminConversationActionCursor(actionCursor)).toEqual({
      requestEveCursor: 12,
      id: "22222222-2222-4222-8222-222222222222",
    });
    expect(() =>
      decodeAdminConversationActionCursor(cursor),
    ).toThrowError();
  });
});
