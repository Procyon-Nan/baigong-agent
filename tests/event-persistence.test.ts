import type { HandleMessageStreamEvent } from "eve/client";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/src/server/db/client";
import { createConversationEventPersistence } from "@/src/server/conversations/event-persistence";

describe("conversation event persistence", () => {
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid durable cursor before opening a transaction: %s",
    async (cursor) => {
      const transaction = vi.fn();
      const persistence = createConversationEventPersistence({
        transaction,
      } as unknown as Database);

      await expect(
        persistence.applyEvent("conversation-1", cursor, sessionStartedEvent()),
      ).rejects.toMatchObject({ code: "CONVERSATION_PERSISTENCE_FAILED" });
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});

function sessionStartedEvent(): HandleMessageStreamEvent {
  return {
    type: "session.started",
    data: {},
    meta: { at: "2026-08-03T08:00:00.000Z" },
  };
}
