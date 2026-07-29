import { resolve } from "node:path";
import { z } from "zod";
import { ApplicationError } from "@/src/server/errors";

const databaseUrlSchema = z.string().trim().min(1).refine(
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

const environmentSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  BAIGONG_DATA_DIR: z.string().trim().min(1).default(".data"),
});

export type ServerEnvironment = {
  readonly databaseUrl: string;
  readonly dataDirectory: string;
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

  return {
    databaseUrl: parsed.data.DATABASE_URL,
    dataDirectory: resolve(projectRoot, parsed.data.BAIGONG_DATA_DIR),
  };
}

export function readDataDirectory(
  source: EnvironmentSource = process.env,
  projectRoot: string = process.cwd(),
): string {
  const parsed = environmentSchema.shape.BAIGONG_DATA_DIR.safeParse(source.BAIGONG_DATA_DIR);

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
