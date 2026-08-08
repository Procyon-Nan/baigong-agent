import { z } from "zod";
import { ApplicationError } from "@/src/server/errors";

const skillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]{0,79}$/);
const skillFields = {
  name: skillNameSchema,
  description: z.string().trim().min(1).max(500),
  markdown: z.string().trim().min(1).max(100_000),
} as const;

export const createSkillRequestSchema = z.strictObject(skillFields);
export const updateSkillRequestSchema = z.strictObject(skillFields);

export const saveAgentCapabilitiesRequestSchema = z.strictObject({
  toolIds: z.array(z.string().min(1).max(80)).max(32),
  skillVersionIds: z.array(z.uuid()).max(100),
});

export type CreateSkillRequest = z.output<typeof createSkillRequestSchema>;
export type UpdateSkillRequest = z.output<typeof updateSkillRequestSchema>;
export type SaveAgentCapabilitiesRequest = z.output<
  typeof saveAgentCapabilitiesRequestSchema
>;

export function parseSkillId(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ApplicationError({
    code: "INVALID_SKILL_ID",
    message: "Skill 标识无效。",
    status: 400,
    expose: true,
    cause: parsed.error,
  });
}
