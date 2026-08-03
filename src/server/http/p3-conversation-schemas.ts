import { z } from "zod";
import { ApplicationError } from "@/src/server/errors";

export const P3_CONVERSATION_REQUEST_MAX_BYTES = 128 * 1_024;
export const P3_MESSAGE_MAX_CHARACTERS = 32_000;

const messageSchema = z
  .string()
  .refine((value) => value.trim().length > 0)
  .refine(
    (value) => Array.from(value).length <= P3_MESSAGE_MAX_CHARACTERS,
  );

export const createConversationMessageSchema = z.strictObject({
  message: messageSchema,
  requestId: z.uuid(),
});

export const submitConversationMessageSchema = z.strictObject({
  message: messageSchema,
  requestId: z.uuid(),
  retryOfTurnId: z.uuid().optional(),
});

export const cancelConversationTurnSchema = z.strictObject({
  turnId: z.uuid(),
});

export const conversationIdSchema = z.uuid();

export const conversationEventCursorSchema = z.coerce
  .number()
  .int()
  .min(-1)
  .max(Number.MAX_SAFE_INTEGER - 1)
  .default(-1);

export type SubmitConversationMessageRequest = z.output<
  typeof submitConversationMessageSchema
>;

export function parseConversationId(value: string): string {
  const parsed = conversationIdSchema.safeParse(value);
  if (!parsed.success) throw invalidConversationParameter();
  return parsed.data;
}

export function parseConversationEventCursor(value: string | null): number {
  const parsed = conversationEventCursorSchema.safeParse(value ?? undefined);
  if (!parsed.success) throw invalidConversationParameter();
  return parsed.data;
}

function invalidConversationParameter(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_CONVERSATION_PARAMETER",
    message: "对话参数无效。",
    status: 400,
    expose: true,
  });
}
