import "server-only";

import { generateText } from "ai";
import { writeSecurityAudit } from "@/src/server/audit/repository";
import {
  assertAdminPrincipal,
  type AdminPrincipal,
} from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import { ApplicationError } from "@/src/server/errors";
import type { ModelConfigurationRequest } from "@/src/server/http/p3-model-schemas";
import { resolveApiKeyForTest } from "./configuration";
import { createChatCompletionsModel } from "./runtime";
import { normalizeModelBaseUrl } from "./validation";

export const MODEL_TEST_PROMPT = "你好，请问你是谁，来自何处？";
export const MODEL_TEST_TIMEOUT_MS = 5 * 60 * 1_000;

export type ModelConnectionTestResult = {
  readonly output: string;
  readonly durationMs: number;
  readonly usage: {
    readonly inputTokens: number | undefined;
    readonly outputTokens: number | undefined;
    readonly totalTokens: number | undefined;
  };
};

export async function testModelConfiguration(
  actor: AdminPrincipal,
  input: ModelConfigurationRequest,
): Promise<ModelConnectionTestResult> {
  assertAdminPrincipal(actor);
  const startedAt = performance.now();
  try {
    const apiKey = await resolveApiKeyForTest(actor.tenantId, input.apiKey);
    const model = createChatCompletionsModel(
      {
        baseUrl: normalizeModelBaseUrl(input.baseUrl),
        modelName: input.modelName.trim(),
        apiKey,
      },
      { timeoutMs: MODEL_TEST_TIMEOUT_MS },
    );
    const result = await generateText({
      model,
      prompt: MODEL_TEST_PROMPT,
      maxRetries: 0,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    await auditTest(actor, "SUCCESS", durationMs);
    return {
      output: result.text,
      durationMs,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      },
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    await auditTest(actor, "FAILURE", durationMs);
    throw new ApplicationError({
      code: "MODEL_CONNECTION_TEST_FAILED",
      message: "模型连通性测试失败，请检查配置。",
      status: 502,
      expose: true,
      cause: error,
    });
  }
}

async function auditTest(
  actor: AdminPrincipal,
  outcome: "SUCCESS" | "FAILURE",
  durationMs: number,
): Promise<void> {
  await writeSecurityAudit(getDatabase(), {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorSource: "LOCAL",
    action: "MODEL_CONNECTION_TESTED",
    targetType: "MODEL_CONFIGURATION",
    outcome,
    metadata: { durationMs },
  });
}
