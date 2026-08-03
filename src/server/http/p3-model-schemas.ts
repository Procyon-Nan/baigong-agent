import { z } from "zod";
import { normalizeModelBaseUrl } from "@/src/server/models/validation";

const modelConfigurationFields = {
  providerDisplayName: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().min(1).max(2_048).transform(normalizeModelBaseUrl),
  modelName: z.string().trim().min(1).max(255),
  contextWindowTokens: z.int().positive().max(2_147_483_647).nullable(),
  apiKey: z.string().max(16_384).nullable().optional(),
} as const;

export const saveModelConfigurationRequestSchema = z.strictObject(
  modelConfigurationFields,
);

export const testModelConfigurationRequestSchema = z.strictObject(
  modelConfigurationFields,
);

export type ModelConfigurationRequest = z.output<
  typeof saveModelConfigurationRequestSchema
>;
