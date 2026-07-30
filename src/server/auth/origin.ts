import { ApplicationError } from "@/src/server/errors";
import { readApplicationOrigin } from "@/src/server/config/environment";

export function normalizeAllowedOrigin(
  value: string,
  production: boolean,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidOrigin();
  }

  const isLocalDevelopment =
    !production &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]");

  if (
    url.origin !== value.trim() ||
    url.hostname.includes("*") ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !isLocalDevelopment)
  ) {
    throw invalidOrigin();
  }

  return url.origin;
}

export function normalizeAllowedOrigins(
  values: readonly string[],
  production: boolean,
): string[] {
  const origins = [
    ...new Set(
      values.map((value) => normalizeAllowedOrigin(value, production)),
    ),
  ];
  if (origins.length === 0 || origins.length > 20) {
    throw invalidOrigin();
  }
  return origins.sort();
}

export function assertSameOriginRequest(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== readApplicationOrigin()) {
    throw new ApplicationError({
      code: "INVALID_REQUEST_ORIGIN",
      message: "请求来源无效。",
      status: 403,
      expose: true,
    });
  }
}

function invalidOrigin(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_ALLOWED_ORIGIN",
    message: "Origin 必须是精确的 HTTPS Origin；开发环境仅额外允许 localhost。",
    status: 400,
    expose: true,
  });
}
