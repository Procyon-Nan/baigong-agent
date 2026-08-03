import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { ApplicationError } from "@/src/server/errors";
import type { ResolvedModelConfiguration } from "./types";
import { resolveModelConfigurationVersion } from "./version-resolution";

export const MODEL_REQUEST_TIMEOUT_MS = 15 * 60 * 1_000;
const EMPTY_API_KEY_SENTINEL = "baigong-empty-api-key-not-sent";

export type RuntimeModel = {
  readonly model: LanguageModel;
  readonly configuration: Omit<ResolvedModelConfiguration, "apiKey">;
};

export async function resolveRuntimeModel(
  tenantId: string,
  modelConfigVersionId: string,
): Promise<RuntimeModel> {
  const configuration = await resolveModelConfigurationVersion(
    tenantId,
    modelConfigVersionId,
  );
  const { apiKey, ...publicConfiguration } = configuration;
  return {
    model: createChatCompletionsModel(configuration),
    configuration: publicConfiguration,
  };
}

export function createChatCompletionsModel(
  configuration: Pick<
    ResolvedModelConfiguration,
    "apiKey" | "baseUrl" | "modelName"
  >,
  options: {
    readonly timeoutMs?: number;
    readonly fetch?: typeof globalThis.fetch;
  } = {},
): LanguageModel {
  const baseUrl = new URL(configuration.baseUrl);
  const provider = createOpenAI({
    name: "baigong-configured-openai-compatible",
    baseURL: configuration.baseUrl,
    // The provider otherwise reads OPENAI_API_KEY when undefined. The request
    // wrapper below owns the Authorization header and removes this sentinel.
    apiKey: configuration.apiKey ?? EMPTY_API_KEY_SENTINEL,
    fetch: createRestrictedProviderFetch({
      origin: baseUrl.origin,
      apiKey: configuration.apiKey,
      timeoutMs: options.timeoutMs ?? MODEL_REQUEST_TIMEOUT_MS,
      fetch: options.fetch ?? globalThis.fetch,
    }),
  });
  return provider.chat(configuration.modelName);
}

function createRestrictedProviderFetch(options: {
  readonly origin: string;
  readonly apiKey: string | null;
  readonly timeoutMs: number;
  readonly fetch: typeof globalThis.fetch;
}): typeof globalThis.fetch {
  return async (input, init) => {
    const requestUrl = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (requestUrl.origin !== options.origin) {
      throw new ApplicationError({
        code: "MODEL_PROVIDER_ORIGIN_MISMATCH",
        message: "模型请求目标无效。",
      });
    }

    const headers = new Headers(
      typeof input === "string" || input instanceof URL
        ? undefined
        : input.headers,
    );
    new Headers(init?.headers).forEach((value, name) =>
      headers.set(name, value),
    );
    headers.delete("authorization");
    if (options.apiKey) {
      headers.set("authorization", `Bearer ${options.apiKey}`);
    }

    const requestSignal =
      init?.signal ??
      (typeof input === "string" || input instanceof URL
        ? undefined
        : input.signal);
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, timeoutSignal])
      : timeoutSignal;

    return options.fetch(input, {
      ...init,
      headers,
      redirect: "manual",
      signal,
    });
  };
}
