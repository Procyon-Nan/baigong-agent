import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import { getDatabase } from "@/src/server/db/client";
import { conversations, securityAuditEvents } from "@/src/server/db/schema";
import { createConversationRepository } from "@/src/server/conversations/repository";
import type { ReservedConversationTurn } from "@/src/server/conversations/types";
import {
  archiveAdminConversation,
  getAdminConversationAuditDetails,
  getAdminConversationExecutionIndex,
  listAdminConversations,
} from "@/src/server/conversations/service";
import { createLocalUser } from "@/src/server/users/service";
import { configureP4Model } from "./support/p4-conversation-fixtures";
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

describe("P4 administrator conversation audit", () => {
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

  it("lists, inspects and archives another user's conversations", async () => {
    const context = await createContext("admin-audit");
    await configureP4Model(context, 8_192);
    const suffix = randomUUID().slice(0, 8);
    const created = await createLocalUser({
      actor: context.administrator,
      username: `audit-${suffix}`,
      email: `audit-${suffix}@example.test`,
      displayName: "Audit User",
      role: "USER",
    });
    const userPrincipal: AuthenticatedPrincipal = {
      userId: created.user.id,
      tenantId: context.tenantId,
      role: "USER",
      source: "LOCAL",
      sessionId: `test-${randomUUID()}`,
      integrationId: null,
      displayName: created.user.displayName,
      mustChangePassword: false,
    };
    const repository = createConversationRepository();
    const conversationIds: string[] = [];
    let firstReservation: ReservedConversationTurn | null = null;
    for (let index = 0; index < 11; index += 1) {
      const reserved = await repository.reserveCreation(userPrincipal, {
        message: `Audit message ${index}`,
        requestId: randomUUID(),
      });
      if (reserved.kind !== "reserved") {
        throw new Error("Expected a new conversation reservation.");
      }
      firstReservation ??= reserved.value;
      conversationIds.push(reserved.value.conversationId);
      await repository.rejectSubmission(reserved.value);
    }
    if (!firstReservation) throw new Error("Expected a first reservation.");
    const childConversationId = randomUUID();
    await getDatabase().insert(conversations).values({
      id: childConversationId,
      tenantId: context.tenantId,
      ownerUserId: created.user.id,
      ownerSource: "LOCAL",
      kind: "SUBAGENT",
      title: "researcher",
      parentConversationId: firstReservation.conversationId,
      parentTurnId: firstReservation.turnId,
      delegationCallId: `call-${randomUUID()}`,
      subagentName: "researcher",
      linkStatus: "VERIFIED",
      agentId: "researcher",
      eveSessionId: `session-${randomUUID()}`,
      status: "WAITING",
      nextMessageSequence: 0,
    });

    const first = await listAdminConversations(context.administrator, {
      ownerUserId: created.user.id,
      archived: "active",
    });
    expect(first.items).toHaveLength(10);
    expect(first.items[0]?.owner).toMatchObject({
      userId: created.user.id,
      displayName: "Audit User",
      source: "LOCAL",
    });
    const second = await listAdminConversations(context.administrator, {
      ownerUserId: created.user.id,
      archived: "active",
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const targetId = conversationIds[0]!;
    const details = await getAdminConversationAuditDetails(
      context.administrator,
      targetId,
    );
    expect(details.owner.userId).toBe(created.user.id);
    expect(details.messages.items).toEqual([
      expect.objectContaining({
        role: "USER",
        status: "COMPLETED",
        body: "Audit message 0",
      }),
    ]);
    expect(details.subagents).toEqual([
      expect.objectContaining({
        conversationId: childConversationId,
        parentConversationId: targetId,
        name: "researcher",
        linkStatus: "VERIFIED",
        depth: 1,
      }),
    ]);
    await expect(
      getAdminConversationAuditDetails(
        context.administrator,
        childConversationId,
      ),
    ).resolves.toMatchObject({
      conversation: {
        id: childConversationId,
        kind: "SUBAGENT",
        parentConversationId: targetId,
      },
    });
    const execution = await getAdminConversationExecutionIndex(
      context.administrator,
      targetId,
    );
    expect(execution.actions.items).toEqual([]);
    expect(execution.subagents).toHaveLength(1);

    const archived = await archiveAdminConversation(
      context.administrator,
      targetId,
    );
    expect(archived.conversation.archivedAt).toEqual(expect.any(String));
    const archivedPage = await listAdminConversations(context.administrator, {
      ownerUserId: created.user.id,
      archived: "archived",
    });
    expect(archivedPage.items.map(({ id }) => id)).toContain(targetId);

    const auditRows = await getDatabase()
      .select({ action: securityAuditEvents.action })
      .from(securityAuditEvents)
      .where(
        and(
          eq(securityAuditEvents.tenantId, context.tenantId),
          eq(securityAuditEvents.targetId, targetId),
        ),
      );
    expect(auditRows.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        "ADMIN_CONVERSATION_VIEWED",
        "CONVERSATION_ARCHIVED_BY_ADMIN",
      ]),
    );
  }, 60_000);
});

async function createContext(label: string): Promise<P4TestContext> {
  const context = await createP4TestContext(label);
  contexts.push(context);
  return context;
}
