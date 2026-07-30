import { z } from "zod";
import { ApplicationError } from "@/src/server/errors";

export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch (error) {
    throw invalidRequestBody(error);
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidRequestBody(parsed.error);
  return parsed.data;
}

function invalidRequestBody(cause: unknown): ApplicationError {
  return new ApplicationError({
    code: "INVALID_REQUEST_BODY",
    message: "请求内容无效。",
    status: 400,
    expose: true,
    cause,
  });
}
