import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import type { Database } from "@/src/server/db/client";

export const EMBEDDED_TICKET_LIFETIME_MS = 120_000;
export const EMBEDDED_SESSION_LIFETIME_MS = 60 * 60_000;

export type ManagedEmbeddedClient = {
  readonly id: string;
  readonly name: string;
  readonly clientId: string;
  readonly status: "ACTIVE" | "DISABLED";
  readonly allowedOrigins: string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type IntegrationTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export type EmbeddedSessionResult = {
  readonly token: string;
  readonly expiresAt: Date;
  readonly principal: AuthenticatedPrincipal;
};
