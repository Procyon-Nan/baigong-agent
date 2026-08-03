import { ApplicationError } from "@/src/server/errors";

export function normalizeModelBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw invalidBaseUrl(error);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw invalidBaseUrl();
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath || "/";
  return url.toString().replace(/\/$/, "");
}

function invalidBaseUrl(cause?: unknown): ApplicationError {
  return new ApplicationError({
    code: "INVALID_MODEL_BASE_URL",
    message: "模型 Base URL 无效。",
    status: 400,
    expose: true,
    cause,
  });
}
