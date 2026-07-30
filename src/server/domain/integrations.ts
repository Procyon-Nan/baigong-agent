export const EMBEDDED_CLIENT_STATUSES = [
  "ACTIVE",
  "DISABLED",
  "DELETED",
] as const;

export type EmbeddedClientStatus =
  (typeof EMBEDDED_CLIENT_STATUSES)[number];
