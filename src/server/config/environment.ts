import "server-only";

import { resolve } from "node:path";
import { z } from "zod";
import { ApplicationError } from "@/src/server/errors";

const databaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "postgres:" || protocol === "postgresql:";
      } catch {
        return false;
      }
    },
    { message: "DATABASE_URL must be a PostgreSQL URL." },
  );

const applicationOriginSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, context) => {
    try {
      const url = new URL(value);
      if (url.origin !== value || url.username || url.password)
        throw new Error("not an exact origin");
      return url.origin;
    } catch {
      context.addIssue({
        code: "custom",
        message: "BAIGONG_APP_ORIGIN must be an exact origin.",
      });
      return z.NEVER;
    }
  });

const environmentSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  BAIGONG_DATA_DIR: z.string().trim().min(1).default(".data"),
  BAIGONG_APP_ORIGIN: applicationOriginSchema.optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
});

export type ServerEnvironment = {
  readonly databaseUrl: string;
  readonly dataDirectory: string;
  readonly applicationOrigin: string;
};

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function readServerEnvironment(
  source: EnvironmentSource = process.env,
  projectRoot: string = process.cwd(),
): ServerEnvironment {
  const parsed = environmentSchema.safeParse(source);

  if (!parsed.success) {
    throw new ApplicationError({
      code: "INVALID_SERVER_CONFIGURATION",
      message: "服务器基础配置无效。",
      status: 503,
      expose: true,
      cause: parsed.error,
    });
  }

  const applicationOrigin =
    parsed.data.BAIGONG_APP_ORIGIN ??
    (parsed.data.NODE_ENV === "production" ? null : "http://localhost:3000");
  if (
    !applicationOrigin ||
    !isAllowedApplicationOrigin(applicationOrigin, parsed.data.NODE_ENV)
  ) {
    throw new ApplicationError({
      code: "INVALID_APPLICATION_ORIGIN",
      message: "生产环境必须配置 HTTPS BAIGONG_APP_ORIGIN。",
      status: 503,
      expose: true,
    });
  }

  return {
    databaseUrl: parsed.data.DATABASE_URL,
    dataDirectory: resolve(projectRoot, parsed.data.BAIGONG_DATA_DIR),
    applicationOrigin,
  };
}

export function readApplicationOrigin(
  source: EnvironmentSource = process.env,
): string {
  const parsed = environmentSchema
    .pick({ BAIGONG_APP_ORIGIN: true, NODE_ENV: true })
    .safeParse(source);
  if (!parsed.success) {
    throw new ApplicationError({
      code: "INVALID_APPLICATION_ORIGIN",
      message: "应用公开 Origin 配置无效。",
      status: 503,
      expose: true,
      cause: parsed.error,
    });
  }
  const origin =
    parsed.data.BAIGONG_APP_ORIGIN ??
    (parsed.data.NODE_ENV === "production" ? null : "http://localhost:3000");
  if (!origin || !isAllowedApplicationOrigin(origin, parsed.data.NODE_ENV)) {
    throw new ApplicationError({
      code: "INVALID_APPLICATION_ORIGIN",
      message: "生产环境必须配置 HTTPS BAIGONG_APP_ORIGIN。",
      status: 503,
      expose: true,
    });
  }
  return origin;
}

function isAllowedApplicationOrigin(
  origin: string,
  nodeEnvironment: "development" | "production" | "test" | undefined,
): boolean {
  if (nodeEnvironment !== "production" || origin.startsWith("https://"))
    return true;
  const url = new URL(origin);
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]")
  );
}

export function readDataDirectory(
  source: EnvironmentSource = process.env,
  projectRoot: string = process.cwd(),
): string {
  const parsed = environmentSchema.shape.BAIGONG_DATA_DIR.safeParse(
    source.BAIGONG_DATA_DIR,
  );

  if (!parsed.success) {
    throw new ApplicationError({
      code: "INVALID_DATA_DIRECTORY",
      message: "项目数据目录配置无效。",
      status: 503,
      expose: true,
      cause: parsed.error,
    });
  }

  return resolve(projectRoot, parsed.data);
}
