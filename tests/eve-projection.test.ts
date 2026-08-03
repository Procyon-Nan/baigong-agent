import { describe, expect, it } from "vitest";
import {
  createAuthenticationExpiredEvent,
  createHeartbeatEvent,
  projectEveEvent,
  reconcileAssistantText,
  type EveEventProjectionContext,
} from "@/src/server/eve/projection";

const context: EveEventProjectionContext = {
  conversationId: "conversation-public",
  cursor: 8,
  turnId: "turn-public",
  assistantBlockId: "block-public",
};
const meta = { at: "2026-07-30T08:00:00.000Z" };

describe("eve public event projection", () => {
  it("projects only public identifiers and assistant text snapshots", () => {
    const projected = projectEveEvent(
      {
        type: "message.appended",
        meta,
        data: {
          turnId: "turn-eve-internal",
          stepIndex: 12,
          sequence: 4,
          messageDelta: " world",
          messageSoFar: "hello world",
          providerSecret: "must-not-leak",
        },
      },
      context,
    );

    expect(projected).toEqual({
      type: "assistant.delta",
      conversationId: "conversation-public",
      cursor: 8,
      at: meta.at,
      data: {
        turnId: "turn-public",
        blockId: "block-public",
        delta: " world",
        text: "hello world",
      },
    });
    expect(JSON.stringify(projected)).not.toContain("turn-eve-internal");
    expect(JSON.stringify(projected)).not.toContain("providerSecret");
    expect(JSON.stringify(projected)).not.toContain("stepIndex");
  });

  it("drops reasoning, tool, malformed, and future events", () => {
    const disallowed = [
      "reasoning.appended",
      "actions.requested",
      "action.result",
      "authorization.completed",
      "future.event",
    ];

    for (const type of disallowed) {
      expect(projectEveEvent({ type, meta, data: {} }, context)).toBeNull();
    }
    expect(projectEveEvent({ type: "message.appended" }, context)).toBeNull();
    expect(
      projectEveEvent(
        {
          type: "message.appended",
          meta,
          data: { messageDelta: 1, messageSoFar: "invalid" },
        },
        context,
      ),
    ).toBeNull();
  });

  it("projects a subagent entry without exposing eve or delegation identifiers", () => {
    const projected = projectEveEvent(
      {
        type: "subagent.called",
        meta,
        data: {
          callId: "secret-call-id",
          childSessionId: "secret-child-session",
          sessionId: "secret-parent-session",
          workflowId: "secret-workflow",
        },
      },
      {
        ...context,
        subagent: {
          conversationId: "55555555-5555-4555-8555-555555555555",
          name: "researcher",
          linkStatus: "PENDING",
          status: "STARTING",
        },
      },
    );

    expect(projected).toEqual({
      type: "subagent.created",
      conversationId: context.conversationId,
      cursor: context.cursor,
      at: meta.at,
      data: {
        childConversationId: "55555555-5555-4555-8555-555555555555",
        name: "researcher",
        linkStatus: "PENDING",
        status: "STARTING",
      },
    });
    expect(JSON.stringify(projected)).not.toContain("secret-");
  });

  it("projects only user-facing input request fields from a subagent", () => {
    const projected = projectEveEvent(
      {
        type: "input.requested",
        meta,
        data: {
          turnId: "child-eve-turn",
          stepIndex: 4,
          requests: [
            {
              requestId: "request-public-handle",
              prompt: "请选择处理方式",
              display: "select",
              allowFreeform: false,
              options: [
                {
                  id: "retry",
                  label: "重试",
                  description: "使用当前配置重试",
                  style: "primary",
                },
              ],
              action: {
                kind: "tool-call",
                callId: "secret-tool-call",
                toolName: "secret-tool",
                input: { apiKey: "secret-key" },
              },
            },
          ],
        },
      },
      { ...context, interactionOrigin: "SUBAGENT" },
    );

    expect(projected).toEqual({
      type: "input.requested",
      conversationId: context.conversationId,
      cursor: context.cursor,
      at: meta.at,
      data: {
        origin: "SUBAGENT",
        requests: [
          {
            requestId: "request-public-handle",
            prompt: "请选择处理方式",
            display: "select",
            allowFreeform: false,
            options: [
              {
                id: "retry",
                label: "重试",
                description: "使用当前配置重试",
                style: "primary",
              },
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(projected)).not.toContain("secret-");
  });

  it("projects a safe authorization challenge and drops callback internals", () => {
    const projected = projectEveEvent(
      {
        type: "authorization.required",
        meta,
        data: {
          turnId: "child-eve-turn",
          name: "internal-connection-name",
          description: "需要连接知识库",
          webhookUrl: "https://internal.example/callback/secret-token",
          authorization: {
            displayName: "Knowledge Base",
            url: "https://auth.example/activate",
            userCode: "ABCD-1234",
            expiresAt: "2026-07-30T08:10:00.000Z",
            instructions: "完成授权后返回对话。",
            internalToken: "secret-token",
          },
        },
      },
      { ...context, interactionOrigin: "SUBAGENT" },
    );

    expect(projected).toMatchObject({
      type: "authorization.required",
      data: {
        origin: "SUBAGENT",
        description: "需要连接知识库",
        authorization: {
          displayName: "Knowledge Base",
          url: "https://auth.example/activate",
          userCode: "ABCD-1234",
          expiresAt: "2026-07-30T08:10:00.000Z",
          instructions: "完成授权后返回对话。",
        },
      },
    });
    expect(JSON.stringify(projected)).not.toContain("internal-connection");
    expect(JSON.stringify(projected)).not.toContain("webhook");
    expect(JSON.stringify(projected)).not.toContain("secret-token");
  });

  it("redacts raw eve failures and identifies the incomplete draft", () => {
    const projected = projectEveEvent(
      {
        type: "turn.failed",
        meta,
        data: {
          turnId: "turn-eve-internal",
          code: "invalid_api_key",
          message: "Bearer sk-secret was rejected",
          details: { responseBody: "secret provider body" },
        },
      },
      { ...context, failureCode: "MODEL_UNAVAILABLE" },
    );

    expect(projected).toEqual({
      type: "turn.failed",
      conversationId: "conversation-public",
      cursor: 8,
      at: meta.at,
      data: {
        turnId: "turn-public",
        error: {
          code: "MODEL_UNAVAILABLE",
          message: "模型服务暂时不可用，请稍后重试。",
        },
        discardBlockId: "block-public",
      },
    });
    expect(JSON.stringify(projected)).not.toContain("sk-secret");
    expect(JSON.stringify(projected)).not.toContain("invalid_api_key");
  });

  it("maps session boundaries without exposing continuation or session handles", () => {
    const projected = projectEveEvent(
      {
        type: "session.waiting",
        meta,
        data: {
          continuationToken: "eve:secret-continuation",
          sessionId: "internal-session",
        },
      },
      context,
    );

    expect(projected).toEqual({
      type: "conversation.status",
      conversationId: "conversation-public",
      cursor: 8,
      at: meta.at,
      data: { status: "WAITING" },
    });
    expect(JSON.stringify(projected)).not.toContain("continuation");
    expect(JSON.stringify(projected)).not.toContain("internal-session");
  });

  it("projects the remaining allowed turn and assistant completion boundaries", () => {
    expect(
      projectEveEvent(
        {
          type: "message.completed",
          meta,
          data: {
            turnId: "turn-eve-internal",
            message: "final answer",
            finishReason: "stop",
            stepIndex: 3,
          },
        },
        context,
      ),
    ).toMatchObject({
      type: "assistant.completed",
      data: {
        turnId: "turn-public",
        blockId: "block-public",
        text: "final answer",
      },
    });

    for (const type of [
      "turn.started",
      "turn.completed",
      "turn.cancelled",
    ] as const) {
      expect(
        projectEveEvent(
          { type, meta, data: { turnId: "turn-eve-internal" } },
          context,
        ),
      ).toMatchObject({ type, data: { turnId: "turn-public" } });
    }

    const statuses = [
      ["session.started", "RUNNING"],
      ["session.failed", "TERMINAL_FAILED"],
      ["session.completed", "TERMINAL_COMPLETED"],
    ] as const;
    for (const [type, status] of statuses) {
      expect(projectEveEvent({ type, meta, data: {} }, context)).toMatchObject({
        type: "conversation.status",
        data: { status },
      });
    }
  });

  it("uses snapshots to replace a retried draft that is no longer a prefix", () => {
    const appendEvent = projectEveEvent(
      {
        type: "message.appended",
        meta,
        data: {
          turnId: "turn-eve-internal",
          messageDelta: " world",
          messageSoFar: "hello world",
        },
      },
      context,
    );
    const replaceEvent = projectEveEvent(
      {
        type: "message.appended",
        meta,
        data: {
          turnId: "turn-eve-internal",
          messageDelta: "new",
          messageSoFar: "new",
        },
      },
      context,
    );
    if (appendEvent?.type !== "assistant.delta") throw new Error("bad fixture");
    if (replaceEvent?.type !== "assistant.delta") throw new Error("bad fixture");

    expect(reconcileAssistantText("hello", appendEvent)).toEqual({
      mode: "append",
      text: " world",
    });
    expect(reconcileAssistantText("hello world", replaceEvent)).toEqual({
      mode: "replace",
      text: "new",
    });
  });

  it("creates heartbeat and authentication events without advancing state", () => {
    expect(
      createHeartbeatEvent({
        conversationId: context.conversationId,
        cursor: context.cursor,
        at: meta.at,
      }),
    ).toMatchObject({ type: "heartbeat", cursor: context.cursor });
    expect(
      createAuthenticationExpiredEvent({
        conversationId: context.conversationId,
        cursor: context.cursor,
        at: meta.at,
      }),
    ).toMatchObject({
      type: "authentication.expired",
      cursor: context.cursor,
      data: { error: { code: "AUTHENTICATION_EXPIRED" } },
    });
  });
});
