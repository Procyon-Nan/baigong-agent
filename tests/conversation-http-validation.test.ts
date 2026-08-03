import { describe, expect, it } from "vitest";
import {
  P3_CONVERSATION_REQUEST_MAX_BYTES,
  P3_MESSAGE_MAX_CHARACTERS,
  createConversationMessageSchema,
  submitConversationMessageSchema,
} from "@/src/server/http/p3-conversation-schemas";
import { parseJsonBody } from "@/src/server/http/request";

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
});
