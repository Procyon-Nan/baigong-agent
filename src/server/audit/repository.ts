import { securityAuditEvents } from "@/src/server/db/schema";

export type SecurityAuditEvent = {
  readonly tenantId: string;
  readonly actorUserId?: string | null;
  readonly actorSource: "LOCAL" | "EMBEDDED" | "INTEGRATION" | "SYSTEM";
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly outcome: "SUCCESS" | "FAILURE" | "DENIED";
  readonly metadata?: Record<string, string | number | boolean | null>;
};

type AuditDatabase = {
  insert: (table: typeof securityAuditEvents) => {
    values: (
      value: typeof securityAuditEvents.$inferInsert,
    ) => PromiseLike<unknown>;
  };
};

export async function writeSecurityAudit(
  database: AuditDatabase,
  event: SecurityAuditEvent,
): Promise<void> {
  await database.insert(securityAuditEvents).values({
    tenantId: event.tenantId,
    actorUserId: event.actorUserId ?? null,
    actorSource: event.actorSource,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId ?? null,
    outcome: event.outcome,
    metadata: event.metadata ?? {},
  });
}
