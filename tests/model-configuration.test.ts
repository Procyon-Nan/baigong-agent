import { generateText } from "ai";
import { describe, expect, it, vi } from "vitest";
import { saveModelConfigurationRequestSchema } from "@/src/server/http/p3-model-schemas";
import { createChatCompletionsModel } from "@/src/server/models/runtime";
import { runModelToolCallingRoundTrip } from "@/src/server/models/testing";
import { normalizeModelBaseUrl } from "@/src/server/models/validation";

describe("model configuration validation", () => {
  it.each([
    "ftp://models.example.test/v1",
    "https://user:password@models.example.test/v1",
    "https://models.example.test/v1?tenant=a",
    "https://models.example.test/v1#fragment",
  ])("rejects an unsafe Base URL: %s", (baseUrl) => {
    expect(() => normalizeModelBaseUrl(baseUrl)).toThrowError(
      expect.objectContaining({ code: "INVALID_MODEL_BASE_URL" }),
    );
  });

  it("allows HTTP and normalizes trailing slashes", () => {
    expect(normalizeModelBaseUrl("http://models.example.test/v1///")).toBe(
      "http://models.example.test/v1",
    );
  });

  it("rejects unknown request fields", () => {
    expect(
      saveModelConfigurationRequestSchema.safeParse({
        providerDisplayName: "Provider",
        baseUrl: "https://models.example.test/v1",
        modelName: "model-a",
        contextWindowTokens: null,
        apiKey: null,
        environmentApiKey: "must-not-be-accepted",
      }).success,
    ).toBe(false);
  });

  it("defaults both multimodal capability declarations to disabled", () => {
    const configuration = saveModelConfigurationRequestSchema.parse({
      providerDisplayName: "Provider",
      baseUrl: "https://models.example.test/v1",
      modelName: "model-a",
      contextWindowTokens: null,
    });

    expect(configuration).toMatchObject({
      supportsImageInput: false,
      supportsNativePdfInput: false,
    });
  });
});

describe("OpenAI-compatible runtime model", () => {
  it("sends no Authorization header when the database API key is empty", async () => {
    const providerFetch = vi.fn<typeof fetch>(async (input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(init?.redirect).toBe("manual");
      expect(String(input)).toBe(
        "https://models.example.test/v1/chat/completions",
      );
      return chatCompletionResponse("你好");
    });
    const model = createChatCompletionsModel(
      {
        baseUrl: "https://models.example.test/v1",
        modelName: "custom/model:latest",
        apiKey: null,
      },
      { fetch: providerFetch, timeoutMs: 1_000 },
    );

    const result = await generateText({ model, prompt: "hello", maxRetries: 0 });

    expect(result.text).toBe("你好");
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("uses only the explicitly supplied database credential", async () => {
    const previousEnvironmentKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "environment-key-must-not-be-used";
    try {
      const providerFetch = vi.fn<typeof fetch>(async (_input, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer database-key",
        );
        return chatCompletionResponse("ok");
      });
      const model = createChatCompletionsModel(
        {
          baseUrl: "https://models.example.test/v1",
          modelName: "model-a",
          apiKey: "database-key",
        },
        { fetch: providerFetch, timeoutMs: 1_000 },
      );

      await generateText({ model, prompt: "hello", maxRetries: 0 });
    } finally {
      if (previousEnvironmentKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousEnvironmentKey;
      }
    }
  });

  it("verifies a complete tool-calling round trip", async () => {
    const challenge = "5f61ae33-14bd-4746-bca7-66dd761a92ec";
    const requests: Record<string, unknown>[] = [];
    const providerFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const request = parseRequestBody(init?.body);
      requests.push(request);
      return requests.length === 1
        ? toolCallResponse(challenge)
        : chatCompletionResponse("工具调用测试成功");
    });
    const model = createChatCompletionsModel(
      {
        baseUrl: "https://models.example.test/v1",
        modelName: "tool-model",
        apiKey: null,
      },
      { fetch: providerFetch, timeoutMs: 1_000 },
    );

    const result = await runModelToolCallingRoundTrip(model, challenge);

    expect(result).toMatchObject({
      verified: true,
      toolName: "verify_tool_calling",
      output: "工具调用测试成功",
    });
    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(requests[0]).toMatchObject({
      tool_choice: {
        type: "function",
        function: { name: "verify_tool_calling" },
      },
    });
    expect(JSON.stringify(requests[1]?.messages)).toContain(challenge);
  });
});

function parseRequestBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string") throw new Error("Expected a JSON request body.");
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object request body.");
  }
  return value as Record<string, unknown>;
}

function toolCallResponse(challenge: string): Response {
  return Response.json({
    id: "chatcmpl-tool-call",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "tool-model",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-test",
              type: "function",
              function: {
                name: "verify_tool_calling",
                arguments: JSON.stringify({ verificationValue: challenge }),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: {
      prompt_tokens: 4,
      completion_tokens: 2,
      total_tokens: 6,
    },
  });
}

function chatCompletionResponse(text: string): Response {
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "model-a",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  });
}
