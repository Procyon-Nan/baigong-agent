import "dotenv/config";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HandleMessageStreamEvent } from "eve/client";
import { cleanupExpiredPendingAttachments } from "@/src/server/attachments/cleanup";
import {
  deletePendingAttachment,
  getAttachmentContent,
  uploadAttachment,
} from "@/src/server/attachments/service";
import {
  getCurrentAgentCapabilities,
  saveAgentCapabilities,
} from "@/src/server/agents/service";
import { resolveAgentCapabilityVersion } from "@/src/server/agents/runtime";
import {
  listToolReadableAttachments,
  readToolAttachment,
} from "@/src/server/attachments/tool-access";
import { createConversationRepository } from "@/src/server/conversations/repository";
import { createConversationHistoryRepository } from "@/src/server/conversations/history";
import { getDatabase } from "@/src/server/db/client";
import {
  agentConfigVersionTools,
  conversationAttachments,
  conversations,
} from "@/src/server/db/schema";
import { saveModelConfiguration } from "@/src/server/models/configuration";
import { createSkill, updateSkill } from "@/src/server/skills/service";
import {
  cleanupP5TestContext,
  cleanupP5TestDataDirectories,
  configureP5TestDatabase,
  createP5TestContext,
  migrateP5TestDatabase,
  type P5TestContext,
} from "./support/p5-test-database";

configureP5TestDatabase();

const contexts: P5TestContext[] = [];

describe("P5 agent capabilities and attachments", () => {
  beforeAll(async () => {
    await migrateP5TestDatabase();
  });

  afterAll(async () => {
    try {
      for (const context of contexts.reverse()) {
        await cleanupP5TestContext(context);
      }
    } finally {
      const { closeDatabase } = await import("@/src/server/db/client");
      await closeDatabase();
      await cleanupP5TestDataDirectories();
    }
  });

  it("provisions immutable defaults and versions enabled skills", async () => {
    const context = await testContext("capabilities");
    const initial = await getCurrentAgentCapabilities(context.administrator);
    const initialResolved = await resolveAgentCapabilityVersion(
      context.tenantId,
      initial.agent.versionId,
    );
    expect(initial.agent.version).toBe(2);
    expect(initial.enabledToolIds).toEqual([
      "list_conversation_attachments",
      "read_conversation_attachment",
      "todo",
    ]);
    expect(initial.skills).toEqual([
      expect.objectContaining({ name: "evidence_research", enabled: true }),
    ]);

    const unchanged = await saveAgentCapabilities(context.administrator, {
      toolIds: initial.enabledToolIds,
      skillVersionIds: initial.skills
        .filter(({ enabled }) => enabled)
        .map(({ versionId }) => versionId),
    });
    expect(unchanged.agent.versionId).toBe(initial.agent.versionId);

    const created = await createSkill(context.administrator, {
      name: `tenant_skill_${context.suffix.replaceAll("-", "_")}`,
      description: "租户测试 Skill",
      markdown: "# 测试\n\n只返回经过验证的信息。",
    });
    const enabled = await saveAgentCapabilities(context.administrator, {
      toolIds: initial.enabledToolIds,
      skillVersionIds: [initial.skills[0]!.versionId, created.currentVersion.id],
    });
    const edited = await updateSkill(context.administrator, created.id, {
      name: created.name,
      description: "租户测试 Skill 第二版",
      markdown: "# 测试\n\n第二版指令。",
    });
    expect(edited.currentVersion.version).toBe(2);
    expect(edited.enabled).toBe(true);
    const current = await getCurrentAgentCapabilities(context.administrator);
    expect(enabled.agent.version + 1).toBe(current.agent.version);
    expect(
      initialResolved.skills.find(({ name }) => name === "evidence_research")
        ?.version,
    ).toBe(1);
    const editedResolved = await resolveAgentCapabilityVersion(
      context.tenantId,
      current.agent.versionId,
    );
    expect(
      editedResolved.skills.find(({ skillId }) => skillId === created.id),
    ).toMatchObject({
      versionId: edited.currentVersion.id,
      version: 2,
      markdown: "# 测试\n\n第二版指令。",
    });
  }, 30_000);

  it("fails closed when a persisted capability version contains an unknown tool", async () => {
    const context = await testContext("unknown-tool");
    const current = await getCurrentAgentCapabilities(context.administrator);
    await getDatabase().insert(agentConfigVersionTools).values({
      tenantId: context.tenantId,
      configVersionId: current.agent.versionId,
      toolId: "unknown_tool",
    });
    await expect(
      resolveAgentCapabilityVersion(
        context.tenantId,
        current.agent.versionId,
      ),
    ).rejects.toMatchObject({ code: "AGENT_CONFIGURATION_FAILURE" });
  }, 30_000);

  it("persists safe todo and pending question state in conversation snapshots", async () => {
    const context = await testContext("conversation-ui-state");
    await configureModel(context, { image: false, pdf: false });
    const repository = createConversationRepository();
    const reserved = await repository.reserveCreation(context.administrator, {
      message: "制定核查计划",
      requestId: randomUUID(),
    });
    if (reserved.kind !== "reserved") throw new Error("Expected reservation.");
    const sessionId = `session-${randomUUID()}`;
    await repository.recordCreationSession(reserved.value, sessionId);
    await repository.acceptCreation(reserved.value, {
      eveSessionId: sessionId,
      encryptedContinuationToken: null,
      continuationTokenRevision: 0,
    });
    const eveTurnId = `turn-${randomUUID()}`;
    const todoCallId = `todo-${randomUUID()}`;
    const todo = {
      content: "核查知识库结果",
      priority: "high",
      status: "in_progress",
    } as const;
    const events = [
      p5Event("session.started", { sessionId }),
      p5Event("turn.started", { sequence: 1, turnId: eveTurnId }),
      p5Event("message.received", {
        message: "制定核查计划",
        sequence: 1,
        turnId: eveTurnId,
      }),
      p5Event("actions.requested", {
        actions: [
          {
            kind: "tool-call",
            callId: todoCallId,
            toolName: "todo",
            input: { todos: [todo] },
          },
        ],
        sequence: 2,
        stepIndex: 0,
        turnId: eveTurnId,
      }),
      p5Event("action.result", {
        result: {
          kind: "tool-result",
          callId: todoCallId,
          toolName: "todo",
          output: {
            counts: {
              cancelled: 0,
              completed: 0,
              in_progress: 1,
              pending: 0,
              total: 1,
            },
            todos: [todo],
          },
        },
        sequence: 3,
        status: "completed",
        stepIndex: 0,
        turnId: eveTurnId,
      }),
      p5Event("input.requested", {
        requests: [
          {
            requestId: `question-${randomUUID()}`,
            prompt: "是否继续核查？",
            display: "select",
            allowFreeform: true,
            options: [
              {
                id: "continue",
                label: "继续",
                description: "继续当前核查",
                style: "primary",
              },
            ],
            action: {
              kind: "tool-call",
              callId: `ask-${randomUUID()}`,
              toolName: "ask_question",
              input: {},
            },
          },
        ],
        sequence: 4,
        stepIndex: 1,
        turnId: eveTurnId,
      }),
      p5Event("turn.completed", { sequence: 5, turnId: eveTurnId }),
      p5Event("session.waiting", { continuationToken: "continuation-token" }),
    ];
    for (const [cursor, event] of events.entries()) {
      await repository.applyEvent(
        reserved.value.conversationId,
        cursor,
        event,
      );
    }

    const snapshot = await createConversationHistoryRepository().getSnapshot(
      context.administrator,
      reserved.value.conversationId,
    );
    expect(snapshot.uiState).toEqual({
      todos: [todo],
      pendingInput: {
        origin: "MAIN",
        requests: [
          expect.objectContaining({
            prompt: "是否继续核查？",
            allowFreeform: true,
            options: [
              {
                id: "continue",
                label: "继续",
                description: "继续当前核查",
                style: "primary",
              },
            ],
          }),
        ],
      },
    });
    expect(JSON.stringify(snapshot.uiState)).not.toContain("ask_question");
    expect(JSON.stringify(snapshot.uiState)).not.toContain(todoCallId);
  }, 30_000);

  it("uploads idempotently, binds atomically and projects safe history", async () => {
    const context = await testContext("attachment-binding");
    await configureModel(context, { image: true, pdf: false });
    const requestId = randomUUID();
    const bytes = new TextEncoder().encode("not inspected image bytes");
    const first = await uploadAttachment(context.administrator, {
      requestId,
      fileName: "示例.png",
      mediaType: "image/png",
      bytes,
    });
    const duplicate = await uploadAttachment(context.administrator, {
      requestId,
      fileName: "示例.png",
      mediaType: "image/png",
      bytes,
    });
    expect(first.duplicate).toBe(false);
    expect(duplicate).toEqual({ attachment: first.attachment, duplicate: true });

    const repository = createConversationRepository();
    const reservation = await repository.reserveCreation(context.administrator, {
      message: "",
      requestId: randomUUID(),
      attachmentIds: [first.attachment.id],
    });
    expect(reservation.kind).toBe("reserved");
    if (reservation.kind !== "reserved") return;
    expect(reservation.attachments).toEqual([
      expect.objectContaining({ id: first.attachment.id, displayName: "示例.png" }),
    ]);
    const content = await getAttachmentContent(
      context.administrator,
      first.attachment.id,
    );
    expect(Array.from(content.bytes)).toEqual(Array.from(bytes));
    const history = await createConversationHistoryRepository().listMessages(
      context.administrator,
      reservation.value.conversationId,
    );
    expect(history.items[0]).toMatchObject({
      body: "",
      attachments: [
        {
          id: first.attachment.id,
          displayName: "示例.png",
          mediaType: "image/png",
          sizeBytes: bytes.byteLength,
          previewUrl: `/api/attachments/${first.attachment.id}`,
          downloadUrl: `/api/attachments/${first.attachment.id}?download=1`,
        },
      ],
    });

    const eveSessionId = `session-${randomUUID()}`;
    await repository.recordCreationSession(reservation.value, eveSessionId);
    await repository.acceptCreation(reservation.value, {
      eveSessionId,
      encryptedContinuationToken: null,
      continuationTokenRevision: 0,
    });
    const eveTurnId = `turn-${randomUUID()}`;
    await expect(
      repository.applyEvent(
        reservation.value.conversationId,
        0,
        p5Event("session.started", { sessionId: eveSessionId }),
      ),
    ).resolves.toBe(true);
    await expect(
      repository.applyEvent(
        reservation.value.conversationId,
        1,
        p5Event("turn.started", { sequence: 1, turnId: eveTurnId }),
      ),
    ).resolves.toBe(true);
    await expect(
      repository.applyEvent(
        reservation.value.conversationId,
        2,
        receivedAttachmentEvent(eveTurnId, "示例.png", bytes.byteLength + 1),
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_PERSISTENCE_FAILED" });
    await expect(
      repository.applyEvent(
        reservation.value.conversationId,
        2,
        receivedAttachmentEvent(eveTurnId, "示例.png"),
      ),
    ).resolves.toBe(true);
  }, 30_000);

  it("fails closed on unsupported media and enforces pending deletion", async () => {
    const context = await testContext("attachment-policy");
    await configureModel(context, { image: false, pdf: false });
    await expect(
      uploadAttachment(context.administrator, {
        requestId: randomUUID(),
        fileName: "report.pdf",
        mediaType: "application/pdf",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toMatchObject({ code: "MODEL_ATTACHMENT_UNSUPPORTED" });

    await configureModel(context, { image: true, pdf: false });
    const uploaded = await uploadAttachment(context.administrator, {
      requestId: randomUUID(),
      fileName: "delete-me.webp",
      mediaType: "image/webp",
      bytes: new Uint8Array([1, 2, 3]),
    });
    await deletePendingAttachment(context.administrator, uploaded.attachment.id);
    await expect(
      getAttachmentContent(context.administrator, uploaded.attachment.id),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  }, 30_000);

  it("limits attachment tools to the owning root conversation and locked model", async () => {
    const context = await testContext("attachment-tool-access");
    const imageModel = await saveModelConfiguration(context.administrator, {
      providerDisplayName: "P5 Fake Provider",
      baseUrl: "http://127.0.0.1:41999/v1",
      modelName: `fake-${randomUUID()}`,
      contextWindowTokens: 8_192,
      supportsImageInput: true,
      supportsNativePdfInput: false,
      apiKey: null,
    });
    const bytes = new Uint8Array([10, 20, 30]);
    const uploaded = await uploadAttachment(context.administrator, {
      requestId: randomUUID(),
      fileName: "tool-image.png",
      mediaType: "image/png",
      bytes,
    });
    const repository = createConversationRepository();
    const root = await repository.reserveCreation(context.administrator, {
      message: "分析附件",
      requestId: randomUUID(),
      attachmentIds: [uploaded.attachment.id],
    });
    expect(root.kind).toBe("reserved");
    if (root.kind !== "reserved") return;

    const rootAuthority = {
      tenantId: context.tenantId,
      userId: context.administrator.userId,
      source: context.administrator.source,
      conversationId: root.value.conversationId,
      modelConfigVersionId: imageModel.id,
    } as const;
    await expect(listToolReadableAttachments(rootAuthority)).resolves.toEqual([
      expect.objectContaining({ id: uploaded.attachment.id }),
    ]);
    await expect(
      readToolAttachment(rootAuthority, uploaded.attachment.id),
    ).resolves.toMatchObject({
      id: uploaded.attachment.id,
      base64: Buffer.from(bytes).toString("base64"),
    });

    const childId = randomUUID();
    await getDatabase().insert(conversations).values({
      id: childId,
      tenantId: context.tenantId,
      ownerUserId: context.administrator.userId,
      ownerSource: context.administrator.source,
      kind: "SUBAGENT",
      title: "附件 Subagent",
      parentConversationId: root.value.conversationId,
      parentTurnId: root.value.turnId,
      delegationCallId: `call-${randomUUID()}`,
      subagentName: "attachment_reader",
      linkStatus: "VERIFIED",
      agentId: "main",
      status: "WAITING",
    });
    await expect(
      listToolReadableAttachments({ ...rootAuthority, conversationId: childId }),
    ).resolves.toEqual([
      expect.objectContaining({ id: uploaded.attachment.id }),
    ]);

    const otherConversation = await repository.reserveCreation(
      context.administrator,
      { message: "另一个会话", requestId: randomUUID() },
    );
    expect(otherConversation.kind).toBe("reserved");
    if (otherConversation.kind !== "reserved") return;
    await expect(
      listToolReadableAttachments({
        ...rootAuthority,
        conversationId: otherConversation.value.conversationId,
      }),
    ).resolves.toEqual([]);
    await expect(
      readToolAttachment(
        {
          ...rootAuthority,
          conversationId: otherConversation.value.conversationId,
        },
        uploaded.attachment.id,
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_TOOL_ACCESS_DENIED" });
    await expect(
      listToolReadableAttachments({ ...rootAuthority, userId: randomUUID() }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_TOOL_ACCESS_DENIED" });

    const textModel = await saveModelConfiguration(context.administrator, {
      providerDisplayName: "P5 Fake Provider",
      baseUrl: "http://127.0.0.1:41999/v1",
      modelName: `fake-${randomUUID()}`,
      contextWindowTokens: 8_192,
      supportsImageInput: false,
      supportsNativePdfInput: false,
      apiKey: null,
    });
    await expect(
      readToolAttachment(
        { ...rootAuthority, modelConfigVersionId: textModel.id },
        uploaded.attachment.id,
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_TOOL_ACCESS_DENIED" });

    const controller = new AbortController();
    controller.abort();
    await expect(
      readToolAttachment(
        rootAuthority,
        uploaded.attachment.id,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  }, 30_000);

  it("removes pending attachments after 24 hours", async () => {
    const context = await testContext("attachment-cleanup");
    await configureModel(context, { image: true, pdf: false });
    const uploaded = await uploadAttachment(context.administrator, {
      requestId: randomUUID(),
      fileName: "expired.jpg",
      mediaType: "image/jpeg",
      bytes: new Uint8Array([1]),
    });
    await getDatabase()
      .update(conversationAttachments)
      .set({ createdAt: new Date("2026-08-01T00:00:00.000Z") })
      .where(eq(conversationAttachments.id, uploaded.attachment.id));
    const result = await cleanupExpiredPendingAttachments({
      now: new Date("2026-08-03T00:00:00.000Z"),
    });
    expect(result.deletedAttachments).toBeGreaterThanOrEqual(1);
    await expect(
      getAttachmentContent(context.administrator, uploaded.attachment.id),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  }, 30_000);
});

function receivedAttachmentEvent(
  turnId: string,
  filename: string,
  size?: number,
): HandleMessageStreamEvent {
  return p5Event("message.received", {
    turnId,
    sequence: 1,
    message: `[file: ${filename} (image/png)]`,
    parts: [
      {
        type: "file",
        filename,
        mediaType: "image/png",
        ...(size === undefined ? {} : { size }),
        url: "data:image/png;base64,bm90LXBlcnNpc3RlZA==",
      },
    ],
  });
}

function p5Event(
  type: HandleMessageStreamEvent["type"],
  data: Record<string, unknown>,
): HandleMessageStreamEvent {
  return {
    type,
    data,
    meta: { at: new Date().toISOString() },
  } as HandleMessageStreamEvent;
}

async function testContext(label: string): Promise<P5TestContext> {
  const context = await createP5TestContext(label);
  contexts.push(context);
  return context;
}

async function configureModel(
  context: P5TestContext,
  capabilities: { readonly image: boolean; readonly pdf: boolean },
): Promise<void> {
  await saveModelConfiguration(context.administrator, {
    providerDisplayName: "P5 Fake Provider",
    baseUrl: "http://127.0.0.1:41999/v1",
    modelName: `fake-${randomUUID()}`,
    contextWindowTokens: 8_192,
    supportsImageInput: capabilities.image,
    supportsNativePdfInput: capabilities.pdf,
    apiKey: null,
  });
}
