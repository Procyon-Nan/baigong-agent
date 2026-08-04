import { z } from "zod";
import { ApplicationError } from "@/src/server/errors";

const conversationStatusSchema = z.enum([
  "STARTING",
  "RUNNING",
  "CANCELLING",
  "WAITING",
  "TERMINAL_FAILED",
  "TERMINAL_COMPLETED",
]);

export const adminConversationListQuerySchema = z.strictObject({
  userId: emptyAsUndefined(z.string().trim().min(1).max(256).optional()),
  source: emptyAsUndefined(z.enum(["LOCAL", "EMBEDDED"]).optional()),
  status: emptyAsUndefined(conversationStatusSchema.optional()),
  archived: z.enum(["all", "active", "archived"]).default("all"),
  cursor: z.string().trim().min(1).max(1_024).optional(),
});

function emptyAsUndefined<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema);
}

export const adminConversationDetailQuerySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(1_024).optional(),
});

export const adminConversationExecutionQuerySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(1_024).optional(),
});

export function parseAdminConversationListQuery(searchParams: URLSearchParams) {
  return parseQuery(searchParams, adminConversationListQuerySchema, [
    "userId",
    "source",
    "status",
    "archived",
    "cursor",
  ]);
}

export function parseAdminConversationDetailQuery(
  searchParams: URLSearchParams,
) {
  return parseQuery(searchParams, adminConversationDetailQuerySchema, [
    "cursor",
  ]);
}

export function parseAdminConversationExecutionQuery(
  searchParams: URLSearchParams,
) {
  return parseQuery(searchParams, adminConversationExecutionQuerySchema, [
    "cursor",
  ]);
}

function parseQuery<T extends z.ZodType>(
  searchParams: URLSearchParams,
  schema: T,
  allowedKeys: readonly string[],
): z.output<T> {
  const allowed = new Set(allowedKeys);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) {
      throw invalidAdminConversationParameter();
    }
  }
  const input = Object.fromEntries(
    allowedKeys.map((key) => [key, searchParams.get(key) ?? undefined]),
  );
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalidAdminConversationParameter();
  return parsed.data;
}

function invalidAdminConversationParameter(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_ADMIN_CONVERSATION_PARAMETER",
    message: "会话审计参数无效。",
    status: 400,
    expose: true,
  });
}
