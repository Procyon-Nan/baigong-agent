import {
  index,
  integer,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const loginSourceLimits = pgTable(
  "login_source_limits",
  {
    sourceHash: varchar("source_hash", { length: 64 }).primaryKey(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    requestCount: integer("request_count").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("login_source_limits_updated_index").on(table.updatedAt)],
);

export const loginIdentifierFailures = pgTable(
  "login_identifier_failures",
  {
    identifierHash: varchar("identifier_hash", { length: 64 }).primaryKey(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    failureCount: integer("failure_count").notNull(),
    restrictedUntil: timestamp("restricted_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("login_identifier_failures_updated_index").on(table.updatedAt),
  ],
);
