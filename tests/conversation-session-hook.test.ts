import { describe, expect, it, vi } from "vitest";
import { createConversationSessionHook } from "@/agent/hooks/conversation-session";

const identity = {
  authenticator: "baigong-bff",
  principalId: "user-1",
  attributes: {
    tenantId: "239f1821-ca26-41ba-a752-fb98fb4918b1",
    role: "USER",
    source: "LOCAL",
    conversationId: "828e284a-3397-4663-bc4b-f6eddfae57d1",
    turnId: "10492458-213f-43d9-aa4e-f650eaa3f1f4",
    modelConfigVersionId: "7dd2c78f-1758-46a3-862a-753e845813c7",
    agentConfigVersionId: "87777777-7777-4777-8777-777777777777",
  },
} as const;

describe("conversation session hook", () => {
  it("recovers only root sessions and leaves subagent mapping to parent events", async () => {
    const recoverMapping = vi.fn(async () => undefined);
    const hook = createConversationSessionHook({ recoverMapping });
    const onSessionStarted = hook.events?.["session.started"];
    if (!onSessionStarted) throw new Error("Expected session.started hook.");

    await onSessionStarted(
      {} as never,
      sessionContext("root-session") as never,
    );
    expect(recoverMapping).toHaveBeenCalledWith(identity, "root-session");

    recoverMapping.mockClear();
    await onSessionStarted(
      {} as never,
      sessionContext("child-session", {
        callId: "call-1",
        rootSessionId: "root-session",
        sessionId: "root-session",
        turn: { id: "turn_0", sequence: 0 },
      }) as never,
    );
    expect(recoverMapping).not.toHaveBeenCalled();
  });
});

function sessionContext(sessionId: string, parent?: object) {
  return {
    session: {
      id: sessionId,
      auth: { current: identity, initiator: identity },
      parent,
      turn: { id: "turn_0", sequence: 0 },
    },
  };
}
