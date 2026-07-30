import { z } from "zod";
import { USER_ROLES, USER_STATUSES } from "@/src/server/domain/identity";

const nonEmptyString = z.string().trim().min(1);

export const localLoginRequestSchema = z.strictObject({
  identifier: z.string(),
  password: z.string(),
});

export const changePasswordRequestSchema = z.strictObject({
  currentPassword: z.string(),
  newPassword: z.string(),
});

export const createUserRequestSchema = z.strictObject({
  username: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(USER_ROLES),
});

export const updateUserRequestSchema = z
  .strictObject({
    status: z.enum(USER_STATUSES).optional(),
    role: z.enum(USER_ROLES).optional(),
  })
  .refine((value) => value.status !== undefined || value.role !== undefined);

export const createEmbeddedClientRequestSchema = z.strictObject({
  name: z.string(),
  allowedOrigins: z.array(z.string()),
});

export const updateEmbeddedClientRequestSchema = z
  .strictObject({
    name: z.string().optional(),
    allowedOrigins: z.array(z.string()).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.allowedOrigins !== undefined ||
      value.status !== undefined,
  );

export const issueEmbeddedTicketRequestSchema = z.strictObject({
  externalUserId: nonEmptyString.max(255),
  origin: nonEmptyString,
  agentId: nonEmptyString.max(120).optional(),
  displayName: nonEmptyString.max(120).optional(),
  displayEmail: nonEmptyString.max(254).optional(),
});

export const exchangeEmbeddedTicketRequestSchema = z.strictObject({
  ticket: nonEmptyString,
  origin: nonEmptyString,
});
