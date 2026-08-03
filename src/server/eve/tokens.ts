import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { z } from "zod";
import {
  loadOrCreateProjectSecret,
  projectSecrets,
} from "@/src/server/config/data-directory";
import type { EnvironmentSource } from "@/src/server/config/environment";
import { IDENTITY_SOURCES, USER_ROLES } from "@/src/server/domain/identity";
import { ApplicationError } from "@/src/server/errors";

export const EVE_TOKEN_LIFETIME_SECONDS = 60;
export const EVE_JWT_ISSUER = "urn:baigong-agent";
export const EVE_SERVICE_JWT_AUDIENCE = "urn:baigong-agent:eve-service";
export const EVE_ADMIN_STREAM_JWT_AUDIENCE =
  "urn:baigong-agent:eve-admin-stream";

const EVE_SERVICE_TOKEN_PURPOSE = "eve-service";
const EVE_ADMIN_STREAM_TOKEN_PURPOSE = "eve-admin-stream";
const JWT_ALGORITHM = "HS256";
const JWT_TYPE = "JWT";

const opaqueIdentifierSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value.trim() === value);
const resourceIdentifierSchema = z.uuid();

const tokenTimesSchema = {
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  jti: z.uuid(),
} as const;

const eveServiceTokenInputSchema = z
  .strictObject({
    userId: opaqueIdentifierSchema,
    tenantId: resourceIdentifierSchema,
    role: z.enum(USER_ROLES),
    source: z.enum(IDENTITY_SOURCES),
    conversationId: resourceIdentifierSchema,
    turnId: resourceIdentifierSchema,
    modelConfigVersionId: resourceIdentifierSchema,
  })
  .superRefine(assertIdentityCombination);

const eveServiceTokenSchema = z
  .strictObject({
    iss: z.literal(EVE_JWT_ISSUER),
    aud: z.literal(EVE_SERVICE_JWT_AUDIENCE),
    sub: opaqueIdentifierSchema,
    purpose: z.literal(EVE_SERVICE_TOKEN_PURPOSE),
    ...tokenTimesSchema,
    ...eveServiceTokenInputSchema.shape,
  })
  .superRefine((claims, context) => {
    if (claims.sub !== claims.userId) {
      context.addIssue({
        code: "custom",
        message: "JWT subject does not match its user claim.",
      });
    }
    assertIdentityCombination(claims, context);
  });

const eveAdminStreamTokenInputSchema = z.strictObject({
  administratorUserId: opaqueIdentifierSchema,
  tenantId: resourceIdentifierSchema,
  conversationId: resourceIdentifierSchema,
});

const eveAdminStreamTokenSchema = z
  .strictObject({
    iss: z.literal(EVE_JWT_ISSUER),
    aud: z.literal(EVE_ADMIN_STREAM_JWT_AUDIENCE),
    sub: opaqueIdentifierSchema,
    purpose: z.literal(EVE_ADMIN_STREAM_TOKEN_PURPOSE),
    ...tokenTimesSchema,
    ...eveAdminStreamTokenInputSchema.shape,
  })
  .superRefine((claims, context) => {
    if (claims.sub !== claims.administratorUserId) {
      context.addIssue({
        code: "custom",
        message: "JWT subject does not match its administrator claim.",
      });
    }
  });

export type EveServiceTokenInput = z.input<typeof eveServiceTokenInputSchema>;
export type VerifiedEveServiceToken = z.output<typeof eveServiceTokenSchema>;
export type EveAdminStreamTokenInput = z.input<typeof eveAdminStreamTokenInputSchema>;
export type VerifiedEveAdminStreamToken = z.output<
  typeof eveAdminStreamTokenSchema
>;

export type IssuedEveToken = {
  readonly token: string;
  readonly expiresAt: Date;
};

type EveTokenOptions = {
  readonly source?: EnvironmentSource;
  readonly projectRoot?: string;
  readonly now?: Date;
};

export async function issueEveServiceToken(
  input: EveServiceTokenInput,
  options: EveTokenOptions = {},
): Promise<IssuedEveToken> {
  const claims = eveServiceTokenInputSchema.parse(input);
  return issueToken(
    {
      ...claims,
      purpose: EVE_SERVICE_TOKEN_PURPOSE,
    },
    claims.userId,
    EVE_SERVICE_JWT_AUDIENCE,
    options,
  );
}

export async function verifyEveServiceToken(
  token: string,
  options: EveTokenOptions = {},
): Promise<VerifiedEveServiceToken> {
  return verifyToken(
    token,
    EVE_SERVICE_JWT_AUDIENCE,
    eveServiceTokenSchema,
    options,
  );
}

export async function issueEveAdminStreamToken(
  input: EveAdminStreamTokenInput,
  options: EveTokenOptions = {},
): Promise<IssuedEveToken> {
  const claims = eveAdminStreamTokenInputSchema.parse(input);
  return issueToken(
    {
      ...claims,
      purpose: EVE_ADMIN_STREAM_TOKEN_PURPOSE,
    },
    claims.administratorUserId,
    EVE_ADMIN_STREAM_JWT_AUDIENCE,
    options,
  );
}

export async function verifyEveAdminStreamToken(
  token: string,
  options: EveTokenOptions = {},
): Promise<VerifiedEveAdminStreamToken> {
  return verifyToken(
    token,
    EVE_ADMIN_STREAM_JWT_AUDIENCE,
    eveAdminStreamTokenSchema,
    options,
  );
}

async function issueToken(
  claims: JWTPayload,
  subject: string,
  audience: string,
  options: EveTokenOptions,
): Promise<IssuedEveToken> {
  const now = currentTime(options.now);
  const expiresAtSeconds = now + EVE_TOKEN_LIFETIME_SECONDS;
  const key = await loadSigningKey(options);
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: JWT_ALGORITHM, typ: JWT_TYPE })
    .setIssuer(EVE_JWT_ISSUER)
    .setAudience(audience)
    .setSubject(subject)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(expiresAtSeconds)
    .sign(key);

  return {
    token,
    expiresAt: new Date(expiresAtSeconds * 1_000),
  };
}

async function verifyToken<TClaims>(
  token: string,
  audience: string,
  schema: z.ZodType<TClaims>,
  options: EveTokenOptions,
): Promise<TClaims> {
  const key = await loadSigningKey(options);
  const now = currentTime(options.now);

  try {
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      algorithms: [JWT_ALGORITHM],
      issuer: EVE_JWT_ISSUER,
      audience,
      currentDate: new Date(now * 1_000),
    });
    if (
      protectedHeader.alg !== JWT_ALGORITHM ||
      protectedHeader.typ !== JWT_TYPE ||
      Object.keys(protectedHeader).length !== 2
    ) {
      throw new Error("Unexpected JWT protected header.");
    }

    const claims = schema.parse(payload);
    assertTokenLifetime(claims as JWTPayload, now);
    return claims;
  } catch (error) {
    throw invalidToken(error);
  }
}

async function loadSigningKey(options: EveTokenOptions): Promise<Buffer> {
  return loadOrCreateProjectSecret(
    projectSecrets.jwtSigning.fileName,
    projectSecrets.jwtSigning.length,
    options.source,
    options.projectRoot,
  );
}

function currentTime(now: Date | undefined): number {
  const milliseconds = (now ?? new Date()).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new ApplicationError({
      code: "INVALID_TOKEN_CLOCK",
      message: "服务令牌时钟无效。",
    });
  }
  return Math.floor(milliseconds / 1_000);
}

function assertTokenLifetime(payload: JWTPayload, now: number): void {
  if (
    payload.iat === undefined ||
    payload.exp === undefined ||
    payload.iat > now ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat !== EVE_TOKEN_LIFETIME_SECONDS
  ) {
    throw new Error("Invalid JWT lifetime.");
  }
}

function assertIdentityCombination(
  claims: { readonly role: "USER" | "ADMIN"; readonly source: "LOCAL" | "EMBEDDED" },
  context: z.RefinementCtx,
): void {
  if (claims.source === "EMBEDDED" && claims.role !== "USER") {
    context.addIssue({
      code: "custom",
      message: "Embedded principals must use the user role.",
    });
  }
}

function invalidToken(cause: unknown): ApplicationError {
  return new ApplicationError({
    code: "INVALID_EVE_TOKEN",
    message: "服务认证令牌无效。",
    status: 401,
    cause,
  });
}
