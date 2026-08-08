import "server-only";

import { randomUUID } from "node:crypto";
import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
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
export const MODEL_TOOL_CALLING_TEST_TOOL = "verify_tool_calling";

export type ModelConnectionTestResult = {
  readonly output: string;
  readonly durationMs: number;
  readonly usage: {
    readonly inputTokens: number | undefined;
    readonly outputTokens: number | undefined;
    readonly totalTokens: number | undefined;
  };
};

export type ModelToolCallingTestResult = ModelConnectionTestResult & {
  readonly verified: true;
  readonly toolName: typeof MODEL_TOOL_CALLING_TEST_TOOL;
};

export async function testModelConfiguration(
  actor: AdminPrincipal,
  input: ModelConfigurationRequest,
): Promise<ModelConnectionTestResult> {
  assertAdminPrincipal(actor);
  const startedAt = performance.now();
  try {
    const model = await createTestModel(actor.tenantId, input);
    const result = await generateText({
      model,
      prompt: MODEL_TEST_PROMPT,
      maxRetries: 0,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    await auditTest(actor, "MODEL_CONNECTION_TESTED", "SUCCESS", durationMs);
    return {
      output: result.text,
      durationMs,
      usage: toTestUsage(result.usage),
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    await auditTest(actor, "MODEL_CONNECTION_TESTED", "FAILURE", durationMs);
    throw new ApplicationError({
      code: "MODEL_CONNECTION_TEST_FAILED",
      message: "模型连通性测试失败，请检查配置。",
      status: 502,
      expose: true,
      cause: error,
    });
  }
}

export async function testModelToolCalling(
  actor: AdminPrincipal,
  input: ModelConfigurationRequest,
): Promise<ModelToolCallingTestResult> {
  assertAdminPrincipal(actor);
  const startedAt = performance.now();
  try {
    const model = await createTestModel(actor.tenantId, input);
    const result = await runModelToolCallingRoundTrip(model);
    const durationMs = Math.round(performance.now() - startedAt);
    await auditTest(actor, "MODEL_TOOL_CALLING_TESTED", "SUCCESS", durationMs);
    return {
      verified: true,
      toolName: MODEL_TOOL_CALLING_TEST_TOOL,
      output: result.output,
      durationMs,
      usage: result.usage,
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    await auditTest(actor, "MODEL_TOOL_CALLING_TESTED", "FAILURE", durationMs);
    throw new ApplicationError({
      code: "MODEL_TOOL_CALLING_TEST_FAILED",
      message: "模型工具调用测试失败，请确认模型支持完整的工具调用往返。",
      status: 502,
      expose: true,
      cause: error,
    });
  }
}

export async function runModelToolCallingRoundTrip(
  model: LanguageModel,
  challenge = randomUUID(),
): Promise<Omit<ModelToolCallingTestResult, "durationMs">> {
  let verified = false;
  const result = await generateText({
    model,
    prompt: [
      `请调用 ${MODEL_TOOL_CALLING_TEST_TOOL} 工具。`,
      `参数 verificationValue 必须精确填写为：${challenge}`,
      "工具返回后，请用一句话确认测试结果。",
    ].join("\n"),
    tools: {
      [MODEL_TOOL_CALLING_TEST_TOOL]: tool({
        description: "验证模型能否完成一次无副作用的工具调用。",
        inputSchema: z.object({
          verificationValue: z.literal(challenge),
        }),
        execute: async ({ verificationValue }) => {
          verified = verificationValue === challenge;
          return { verified, verificationValue };
        },
      }),
    },
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0
        ? {
            activeTools: [MODEL_TOOL_CALLING_TEST_TOOL],
            toolChoice: {
              type: "tool",
              toolName: MODEL_TOOL_CALLING_TEST_TOOL,
            },
          }
        : { activeTools: [], toolChoice: "none" },
    stopWhen: stepCountIs(2),
    maxRetries: 0,
  });
  if (!verified || result.text.trim().length === 0) {
    throw new Error("The model did not complete the tool-calling round trip.");
  }
  return {
    verified: true,
    toolName: MODEL_TOOL_CALLING_TEST_TOOL,
    output: result.text,
    usage: toTestUsage(result.usage),
  };
}

async function createTestModel(
  tenantId: string,
  input: ModelConfigurationRequest,
) {
  const apiKey = await resolveApiKeyForTest(tenantId, input.apiKey);
  return createChatCompletionsModel(
    {
      baseUrl: normalizeModelBaseUrl(input.baseUrl),
      modelName: input.modelName.trim(),
      apiKey,
    },
    { timeoutMs: MODEL_TEST_TIMEOUT_MS },
  );
}

async function auditTest(
  actor: AdminPrincipal,
  action: "MODEL_CONNECTION_TESTED" | "MODEL_TOOL_CALLING_TESTED",
  outcome: "SUCCESS" | "FAILURE",
  durationMs: number,
): Promise<void> {
  await writeSecurityAudit(getDatabase(), {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorSource: "LOCAL",
    action,
    targetType: "MODEL_CONFIGURATION",
    outcome,
    metadata: { durationMs },
  });
}

function toTestUsage(usage: {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly totalTokens: number | undefined;
}): ModelConnectionTestResult["usage"] {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}
