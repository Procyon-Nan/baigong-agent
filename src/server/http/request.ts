import { z } from "zod";
import { ApplicationError } from "@/src/server/errors";

export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  options: { readonly maxBytes?: number } = {},
): Promise<z.output<TSchema>> {
  let value: unknown;
  try {
    if (options.maxBytes === undefined) {
      value = await request.json();
    } else {
      const declaredLength = request.headers.get("content-length");
      if (
        declaredLength !== null &&
        (!/^\d+$/.test(declaredLength) ||
          Number(declaredLength) > options.maxBytes)
      ) {
        if (/^\d+$/.test(declaredLength)) throw requestBodyTooLarge();
        throw new Error("Request Content-Length is invalid.");
      }
      const bytes = await readBoundedBody(request, options.maxBytes);
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw invalidRequestBody(error);
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidRequestBody(parsed.error);
  return parsed.data;
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw requestBodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function requestBodyTooLarge(): ApplicationError {
  return new ApplicationError({
    code: "REQUEST_BODY_TOO_LARGE",
    message: "请求内容过大。",
    status: 413,
    expose: true,
  });
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
