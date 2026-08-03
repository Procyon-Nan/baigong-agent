import { generateText } from "ai";
import { describe, expect, it, vi } from "vitest";
import { saveModelConfigurationRequestSchema } from "@/src/server/http/p3-model-schemas";
import { createChatCompletionsModel } from "@/src/server/models/runtime";
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
});

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
