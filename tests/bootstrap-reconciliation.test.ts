import { describe, expect, it, vi } from "vitest";
import { scheduleConversationReconciliation } from "@/src/server/bootstrap";

describe("conversation startup reconciliation", () => {
  it("does not schedule without a database or during a production build", () => {
    const schedule = vi.fn();

    scheduleConversationReconciliation({}, { schedule });
    scheduleConversationReconciliation(
      {
        DATABASE_URL: "postgresql://localhost/application",
        NEXT_PHASE: "phase-production-build",
      },
      { schedule },
    );

    expect(schedule).not.toHaveBeenCalled();
  });

  it("schedules reconciliation after server initialization", async () => {
    const reconcile = vi.fn().mockResolvedValue(undefined);
    const tasks: Array<() => void> = [];
    const schedule = vi.fn((scheduled: () => void) => {
      tasks.push(scheduled);
    });

    scheduleConversationReconciliation(
      { DATABASE_URL: "postgresql://localhost/application" },
      { delayMs: 25, intervalMs: 30_000, reconcile, schedule },
    );

    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 25);
    tasks.shift()?.();
    await vi.waitFor(() => expect(schedule).toHaveBeenCalledTimes(2));
    expect(reconcile).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 30_000);

    tasks.shift()?.();
    await vi.waitFor(() => expect(schedule).toHaveBeenCalledTimes(3));
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});
