import "dotenv/config";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDatabase } from "@/src/server/db/client";
import {
  conversationMessages,
  conversations,
} from "@/src/server/db/schema";
import { assertMainConversationQuota } from "@/src/server/conversations/limits";
import { createConversationRepository } from "@/src/server/conversations/repository";
import {
  archiveConversation,
  getConversationSnapshot,
  listConversationMessages,
  listConversationUserMessageNodes,
  listConversations,
  restoreConversation,
} from "@/src/server/conversations/service";
import { prepareP4Conversation } from "./support/p4-conversation-fixtures";
import {
  cleanupP4TestContext,
  cleanupP4TestDataDirectories,
  configureP4TestDatabase,
  createP4TestContext,
  migrateP4TestDatabase,
  type P4TestContext,
} from "./support/p4-test-database";

configureP4TestDatabase();

const contexts: P4TestContext[] = [];

describe("P4 conversation listing", () => {
  beforeAll(async () => {
    await migrateP4TestDatabase();
  });

  afterAll(async () => {
    try {
      for (const context of contexts.reverse()) {
        await cleanupP4TestContext(context);
      }
    } finally {
      const { closeDatabase } = await import("@/src/server/db/client");
      await closeDatabase();
      await cleanupP4TestDataDirectories();
    }
  });

  it("paginates only owned main conversations with ten-item cursors", async () => {
    const context = await createContext("list");
    const database = getDatabase();
    const now = Date.now();
    await database.insert(conversations).values(
      Array.from({ length: 12 }, (_, index) => {
        const timestamp = new Date(now + index);
        return {
          id: randomUUID(),
          tenantId: context.tenantId,
          ownerUserId: context.administratorId,
          ownerSource: "LOCAL" as const,
          kind: "MAIN" as const,
          title: `Conversation ${index}`,
          agentId: "main",
          status: "WAITING" as const,
          nextMessageSequence: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      }),
    );

    const first = await listConversations(context.administrator, {
      archived: false,
    });
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listConversations(context.administrator, {
      archived: false,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(2);
    const firstIds = new Set(first.items.map(({ id }) => id));
    expect(second.items.some(({ id }) => firstIds.has(id))).toBe(false);
    expect(second.nextCursor).toBeNull();
  }, 30_000);

  it("enforces the quota only for unarchived main conversations", async () => {
    const context = await createContext("quota");
    const database = getDatabase();
    const rows = Array.from({ length: 50 }, () => {
      const timestamp = new Date();
      return {
        id: randomUUID(),
        tenantId: context.tenantId,
        ownerUserId: context.administratorId,
        ownerSource: "LOCAL" as const,
        kind: "MAIN" as const,
        agentId: "main",
        status: "WAITING" as const,
        nextMessageSequence: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });
    await database.insert(conversations).values(rows);
    await expect(
      createConversationRepository().reserveCreation(context.administrator, {
        message: "quota",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONVERSATION_LIMIT_REACHED" });

    await database
      .update(conversations)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(conversations.tenantId, context.tenantId),
          eq(conversations.id, rows[0]!.id),
        ),
      );
    await expect(
      assertMainConversationQuota(database, context.administrator),
    ).resolves.toBeUndefined();
  }, 30_000);

  it("supports history, user nodes, snapshot, archive and restore", async () => {
    const context = await createContext("history");
    const prepared = await prepareP4Conversation(context, "first question");
    const database = getDatabase();
    const conversationId = prepared.reservation.conversationId;
    const turnId = prepared.reservation.turnId;
    await database.insert(conversationMessages).values([
      {
        id: randomUUID(),
        tenantId: context.tenantId,
        conversationId,
        turnId,
        sequence: 2,
        role: "ASSISTANT",
        status: "COMPLETED",
        blockId: `assistant/${conversationId}/0`,
        body: "answer",
        stepIndex: 0,
      },
      {
        id: randomUUID(),
        tenantId: context.tenantId,
        conversationId,
        turnId,
        sequence: 3,
        role: "USER",
        status: "COMPLETED",
        blockId: `user/${conversationId}/second`,
        body: "second question",
      },
      {
        id: randomUUID(),
        tenantId: context.tenantId,
        conversationId,
        turnId,
        sequence: 4,
        role: "ASSISTANT",
        status: "HIDDEN",
        blockId: `assistant/${conversationId}/hidden`,
        body: "hidden draft",
        stepIndex: 1,
      },
    ]);

    const messages = await listConversationMessages(context.administrator, conversationId);
    expect(messages.items.map(({ body }) => body)).toEqual([
      "first question",
      "answer",
      "second question",
    ]);
    const nodes = await listConversationUserMessageNodes(
      context.administrator,
      conversationId,
    );
    expect(nodes.items.map(({ summary }) => summary)).toEqual([
      "first question",
      "second question",
    ]);
    const snapshot = await getConversationSnapshot(
      context.administrator,
      conversationId,
    );
    expect(snapshot.messages.items).toHaveLength(3);
    const listing = await listConversations(context.administrator, {
      archived: false,
    });
    expect(
      listing.items.find(({ id }) => id === conversationId)?.activeTurn,
    ).toEqual({ id: turnId, status: "RUNNING" });
    await expect(
      archiveConversation(context.administrator, conversationId),
    ).rejects.toMatchObject({ code: "CONVERSATION_BUSY" });
    await database
      .update(conversations)
      .set({ status: "WAITING", activeTurnId: null })
      .where(eq(conversations.id, conversationId));
    expect(
      (await archiveConversation(context.administrator, conversationId)).archivedAt,
    ).toEqual(expect.any(String));
    expect(
      (await restoreConversation(context.administrator, conversationId)).archivedAt,
    ).toBeNull();
  }, 30_000);
});

async function createContext(label: string): Promise<P4TestContext> {
  const context = await createP4TestContext(label);
  contexts.push(context);
  return context;
}
