import { z } from "zod";
import { ApplicationError } from "@/src/server/errors";

export const P3_CONVERSATION_REQUEST_MAX_BYTES = 128 * 1_024;
export const P3_MESSAGE_MAX_CHARACTERS = 32_000;

const messageSchema = z
  .string()
  .refine((value) => Array.from(value).length <= P3_MESSAGE_MAX_CHARACTERS);

const attachmentIdsSchema = z.array(z.uuid()).max(5).default([]);

const conversationMessageFields = {
  message: messageSchema,
  requestId: z.uuid(),
  attachmentIds: attachmentIdsSchema,
} as const;

export const createConversationMessageSchema = z
  .strictObject(conversationMessageFields)
  .superRefine(requireMessageContent);

export const submitConversationMessageSchema = z
  .strictObject({
    ...conversationMessageFields,
    retryOfTurnId: z.uuid().optional(),
  })
  .superRefine((value, context) => {
    requireMessageContent(value, context);
    if (value.retryOfTurnId && value.attachmentIds.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Retry requests cannot bind new attachments.",
      });
    }
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

export const conversationListQuerySchema = z.strictObject({
  archived: z.enum(["true", "false"]).default("false"),
  cursor: z.string().trim().min(1).max(512).optional(),
});

export const conversationHistoryQuerySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(512).optional(),
});

export const conversationTitleSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .refine((value) => value.length > 0)
    .refine((value) => Array.from(value).length <= 240),
});

export type SubmitConversationMessageRequest = z.output<
  typeof submitConversationMessageSchema
>;

function requireMessageContent(
  value: { readonly message: string; readonly attachmentIds: readonly string[] },
  context: z.RefinementCtx,
): void {
  if (value.message.trim().length === 0 && value.attachmentIds.length === 0) {
    context.addIssue({
      code: "custom",
      message: "A message or at least one attachment is required.",
    });
  }
}

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

export function parseConversationListQuery(
  searchParams: URLSearchParams,
): z.output<typeof conversationListQuerySchema> {
  assertKnownQueryKeys(searchParams, ["archived", "cursor"]);
  const parsed = conversationListQuerySchema.safeParse({
    archived: searchParams.get("archived") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success) throw invalidConversationParameter();
  return parsed.data;
}

export function parseConversationHistoryQuery(
  searchParams: URLSearchParams,
): z.output<typeof conversationHistoryQuerySchema> {
  assertKnownQueryKeys(searchParams, ["cursor"]);
  const parsed = conversationHistoryQuerySchema.safeParse({
    cursor: searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success) throw invalidConversationParameter();
  return parsed.data;
}

function assertKnownQueryKeys(
  searchParams: URLSearchParams,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of searchParams.keys()) {
    if (
      !allowedKeys.has(key) ||
      searchParams.getAll(key).length !== 1
    ) {
      throw invalidConversationParameter();
    }
  }
}

function invalidConversationParameter(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_CONVERSATION_PARAMETER",
    message: "对话参数无效。",
    status: 400,
    expose: true,
  });
}
