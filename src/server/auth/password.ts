import "server-only";

import { randomBytes } from "node:crypto";
import { hash, verify, type Algorithm } from "@node-rs/argon2";
import { ApplicationError } from "@/src/server/errors";

export const MINIMUM_PASSWORD_LENGTH = 12;

const ARGON2_OPTIONS = {
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function validatePassword(password: string): void {
  if (password.length < MINIMUM_PASSWORD_LENGTH || password.length > 128) {
    throw new ApplicationError({
      code: "INVALID_PASSWORD",
      message: `密码长度必须在 ${MINIMUM_PASSWORD_LENGTH} 到 128 个字符之间。`,
      status: 400,
      expose: true,
    });
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}
