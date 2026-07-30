import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { username } from "better-auth/plugins/username";
import { nextCookies } from "better-auth/next-js";
import { getDatabase } from "@/src/server/db/client";
import * as schema from "@/src/server/db/schema";
import {
  loadOrCreateProjectSecret,
  projectSecrets,
} from "@/src/server/config/data-directory";
import { readApplicationOrigin } from "@/src/server/config/environment";
import { hashPassword, verifyPassword } from "./password";

async function createAuth() {
  const secretDefinition = projectSecrets.betterAuth;
  const secret = await loadOrCreateProjectSecret(
    secretDefinition.fileName,
    secretDefinition.length,
  );

  return betterAuth({
    appName: "百工 Agent",
    baseURL: readApplicationOrigin(),
    secret: secret.toString("base64url"),
    database: drizzleAdapter(getDatabase(), {
      provider: "pg",
      schema,
      transaction: true,
    }),
    user: { modelName: "authUsers" },
    session: {
      modelName: "authSessions",
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    account: {
      modelName: "authAccounts",
      accountLinking: { enabled: false, disableImplicitLinking: true },
    },
    verification: { modelName: "authVerifications" },
    rateLimit: {
      modelName: "authRateLimits",
      enabled: false,
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 64,
        usernameNormalization: (value) => value.trim().toLowerCase(),
        usernameValidator: (value) => /^[a-z0-9][a-z0-9._-]*$/.test(value),
        validationOrder: { username: "post-normalization" },
      }),
      bearer(),
      nextCookies(),
    ],
    advanced: {
      cookiePrefix: "baigong-agent",
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
      useSecureCookies: process.env.NODE_ENV === "production",
    },
  });
}

export type BaigongAuth = Awaited<ReturnType<typeof createAuth>>;

let authPromise: Promise<BaigongAuth> | undefined;

export function getAuth(): Promise<BaigongAuth> {
  authPromise ??= createAuth();
  return authPromise;
}
