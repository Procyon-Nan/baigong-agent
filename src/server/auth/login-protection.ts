import "server-only";

import { sql } from "drizzle-orm";
import { normalizeLoginIdentifier, sha256 } from "./identifiers";
import { getDatabase } from "@/src/server/db/client";
import {
  loginIdentifierFailures,
  loginSourceLimits,
} from "@/src/server/db/schema";
import { ApplicationError } from "@/src/server/errors";

const SOURCE_WINDOW_MS = 10_000;
const SOURCE_MAX_REQUESTS = 3;
const IDENTIFIER_WINDOW_MS = 15 * 60_000;
const IDENTIFIER_MAX_FAILURES = 10;
const IDENTIFIER_RESTRICTION_MS = 15 * 60_000;

export function requestSource(request: Request): string {
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function consumeLoginSourceAttempt(
  source: string,
  now = new Date(),
): Promise<void> {
  const database = getDatabase();
  const threshold = new Date(now.getTime() - SOURCE_WINDOW_MS);
  const [state] = await database
    .insert(loginSourceLimits)
    .values({
      sourceHash: sha256(source),
      windowStartedAt: now,
      requestCount: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: loginSourceLimits.sourceHash,
      set: {
        windowStartedAt: sql`case when ${loginSourceLimits.windowStartedAt} <= ${threshold} then ${now} else ${loginSourceLimits.windowStartedAt} end`,
        requestCount: sql`case when ${loginSourceLimits.windowStartedAt} <= ${threshold} then 1 else ${loginSourceLimits.requestCount} + 1 end`,
        updatedAt: now,
      },
    })
    .returning({ requestCount: loginSourceLimits.requestCount });

  if ((state?.requestCount ?? SOURCE_MAX_REQUESTS + 1) > SOURCE_MAX_REQUESTS) {
    throw new ApplicationError({
      code: "LOGIN_RATE_LIMITED",
      message: "登录请求过于频繁，请稍后重试。",
      status: 429,
      expose: true,
    });
  }
}

export async function isLoginIdentifierRestricted(
  identifier: string,
  now = new Date(),
): Promise<boolean> {
  const database = getDatabase();
  const [state] = await database
    .select({ identifierHash: loginIdentifierFailures.identifierHash })
    .from(loginIdentifierFailures)
    .where(
      sql`${loginIdentifierFailures.identifierHash} = ${identifierDigest(identifier)} and ${loginIdentifierFailures.restrictedUntil} > ${now}`,
    )
    .limit(1);
  return Boolean(state);
}

export async function recordLoginFailure(
  identifier: string,
  now = new Date(),
): Promise<boolean> {
  const database = getDatabase();
  const threshold = new Date(now.getTime() - IDENTIFIER_WINDOW_MS);
  const restrictedUntil = new Date(now.getTime() + IDENTIFIER_RESTRICTION_MS);
  const [state] = await database
    .insert(loginIdentifierFailures)
    .values({
      identifierHash: identifierDigest(identifier),
      windowStartedAt: now,
      failureCount: 1,
      restrictedUntil: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: loginIdentifierFailures.identifierHash,
      set: {
        windowStartedAt: sql`case when ${loginIdentifierFailures.windowStartedAt} <= ${threshold} then ${now} else ${loginIdentifierFailures.windowStartedAt} end`,
        failureCount: sql`case when ${loginIdentifierFailures.windowStartedAt} <= ${threshold} then 1 else ${loginIdentifierFailures.failureCount} + 1 end`,
        restrictedUntil: sql`case
          when ${loginIdentifierFailures.windowStartedAt} <= ${threshold} then null
          when ${loginIdentifierFailures.failureCount} + 1 >= ${IDENTIFIER_MAX_FAILURES} then ${restrictedUntil}
          else ${loginIdentifierFailures.restrictedUntil}
        end`,
        updatedAt: now,
      },
    })
    .returning({ restrictedUntil: loginIdentifierFailures.restrictedUntil });
  return Boolean(state?.restrictedUntil && state.restrictedUntil > now);
}

export async function clearLoginFailures(identifier: string): Promise<void> {
  const database = getDatabase();
  await database
    .delete(loginIdentifierFailures)
    .where(
      sql`${loginIdentifierFailures.identifierHash} = ${identifierDigest(identifier)}`,
    );
}

function identifierDigest(identifier: string): string {
  return sha256(normalizeLoginIdentifier(identifier));
}
