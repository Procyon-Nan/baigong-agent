import "server-only";

import {
  ensureDataDirectory,
  loadOrCreateProjectSecret,
  projectSecrets,
} from "@/src/server/config/data-directory";
import type { EnvironmentSource } from "@/src/server/config/environment";
import { operationalErrorMetadata } from "@/src/server/errors";

let applicationInitialization: Promise<void> | undefined;
const RECONCILIATION_START_DELAY_MS = 1_000;
const RECONCILIATION_INTERVAL_MS = 30_000;

export function initializeApplication(): Promise<void> {
  applicationInitialization ??= initializeProjectData().then(() => {
    scheduleConversationReconciliation();
  });
  return applicationInitialization;
}

export async function initializeProjectData(
  source: EnvironmentSource = process.env,
  projectRoot: string = process.cwd(),
): Promise<void> {
  await ensureDataDirectory(source, projectRoot);
  await Promise.all(
    Object.values(projectSecrets).map((secret) =>
      loadOrCreateProjectSecret(secret.fileName, secret.length, source, projectRoot),
    ),
  );
}

export function scheduleConversationReconciliation(
  source: EnvironmentSource = process.env,
  options: {
    readonly delayMs?: number;
    readonly intervalMs?: number;
    readonly reconcile?: () => Promise<unknown>;
    readonly schedule?: (task: () => void, delayMs: number) => void;
  } = {},
): void {
  if (
    !source.DATABASE_URL ||
    source.NEXT_PHASE === "phase-production-build"
  ) {
    return;
  }

  const schedule =
    options.schedule ??
    ((task: () => void, delayMs: number) => {
      const timer = setTimeout(task, delayMs);
      timer.unref();
    });
  const run = () => {
    void runConversationReconciliation(options.reconcile).finally(() => {
      schedule(run, options.intervalMs ?? RECONCILIATION_INTERVAL_MS);
    });
  };
  schedule(run, options.delayMs ?? RECONCILIATION_START_DELAY_MS);
}

async function runConversationReconciliation(
  reconcile?: () => Promise<unknown>,
): Promise<void> {
  try {
    const reconcilePending =
      reconcile ??
      (await import("@/src/server/conversations/reconciliation"))
        .reconcilePendingConversations;
    await reconcilePending({ expireUnconfirmedSubmissions: true });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "conversation_reconciliation_failed",
        ...operationalErrorMetadata(error),
      }),
    );
  }
}
