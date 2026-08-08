import "server-only";

import { and, asc, desc, eq, gt, inArray, lt, ne, or } from "drizzle-orm";
import { getDatabase, type Database } from "@/src/server/db/client";
import type { PublicConversationUiState } from "@/src/shared/conversation-ui-state";
import {
  conversations,
  conversationAttachments,
  conversationMessages,
  type ConversationKind,
  type ConversationLinkStatus,
  type ConversationStatus,
  type ConversationMessageRole,
  type ConversationMessageStatus,
} from "@/src/server/db/schema";
import {
  encodeConversationHistoryCursor,
  encodeConversationNodeCursor,
  type ConversationHistoryCursor,
  type ConversationNodeCursor,
} from "./conversation-cursors";
import {
  findAccessibleConversation,
  type OwnerPrincipal,
} from "./conversation-ownership";
import {
  conversationNotFound,
  conversationPersistenceFailure,
  invalidConversationCursor,
} from "./errors";
import {
  readActiveTurn,
  toPublicConversation,
} from "./public-conversation";
import type { PublicConversation } from "./types";
import { readConversationUiState } from "./ui-state-repository";
import {
  createConversationUsageRepository,
  type ConversationUsageSummary,
} from "./usage-repository";

export const CONVERSATION_HISTORY_PAGE_SIZE = 50;
export const CONVERSATION_NODE_PAGE_SIZE = 50;

export type ConversationHistoryMessage = {
  readonly id: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly role: ConversationMessageRole;
  readonly status: Exclude<ConversationMessageStatus, "HIDDEN">;
  readonly blockId: string;
  readonly body: string;
  readonly attachments: readonly ConversationHistoryAttachment[];
  readonly stepIndex: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ConversationHistoryAttachment = {
  readonly id: string;
  readonly displayName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly previewUrl: string;
  readonly downloadUrl: string;
};

export type ConversationHistoryPage = {
  readonly items: readonly ConversationHistoryMessage[];
  readonly nextCursor: string | null;
};

export type ConversationUserMessageNode = {
  readonly id: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly summary: string;
  readonly createdAt: string;
};

export type ConversationNodePage = {
  readonly items: readonly ConversationUserMessageNode[];
  readonly nextCursor: string | null;
};

export type ConversationSnapshot = {
  readonly conversation: PublicConversation;
  readonly context: {
    readonly kind: ConversationKind;
    readonly parentConversationId: string | null;
    readonly subagentName: string | null;
    readonly linkStatus: ConversationLinkStatus;
  };
  readonly messages: ConversationHistoryPage;
  readonly hasMoreHistory: boolean;
  readonly lastEveCursor: number | null;
  readonly tokenUsage: ConversationUsageSummary | null;
  readonly subagents: readonly ConversationSubagentSummary[];
  readonly uiState: PublicConversationUiState;
};

export type ConversationSubagentSummary = {
  readonly conversationId: string;
  readonly name: string;
  readonly linkStatus: "PENDING" | "VERIFIED";
  readonly status: ConversationStatus;
  readonly createdAt: string;
};

export function createConversationHistoryRepository(
  database: Database = getDatabase(),
) {
  return {
    async getSnapshot(
      principal: OwnerPrincipal,
      conversationId: string,
      before?: ConversationHistoryCursor,
    ): Promise<ConversationSnapshot> {
      const conversation = await requireAccessibleConversation(
        database,
        principal,
        conversationId,
      );
      if (before) await assertHistoryCursor(database, conversation.id, before);
      const activeTurn = conversation.activeTurnId
        ? await readActiveTurn(database, conversation.activeTurnId)
        : undefined;
      const [messages, tokenUsage, subagents, uiState] = await Promise.all([
        listHistoryPage(database, conversation.id, before),
        createConversationUsageRepository(database).getSummary(
          principal.tenantId,
          conversation.id,
        ),
        listVisibleSubagents(database, principal.tenantId, conversation.id),
        readConversationUiState(
          database,
          principal.tenantId,
          conversation.id,
        ),
      ]);
      return {
        conversation: toPublicConversation(conversation, activeTurn),
        context: {
          kind: conversation.kind,
          parentConversationId: conversation.parentConversationId,
          subagentName: conversation.subagentName,
          linkStatus: conversation.linkStatus,
        },
        messages,
        hasMoreHistory: messages.nextCursor !== null,
        lastEveCursor: safeCursorNumber(conversation.lastEveCursor),
        tokenUsage,
        subagents,
        uiState,
      };
    },

    async listMessages(
      principal: OwnerPrincipal,
      conversationId: string,
      before?: ConversationHistoryCursor,
    ): Promise<ConversationHistoryPage> {
      const conversation = await requireAccessibleConversation(
        database,
        principal,
        conversationId,
      );
      if (before) await assertHistoryCursor(database, conversation.id, before);
      return listHistoryPage(database, conversation.id, before);
    },

    async listUserMessageNodes(
      principal: OwnerPrincipal,
      conversationId: string,
      after?: ConversationNodeCursor,
    ): Promise<ConversationNodePage> {
      const conversation = await requireAccessibleConversation(
        database,
        principal,
        conversationId,
      );
      if (after) await assertNodeCursor(database, conversation.id, after);
      const rows = await database
        .select({
          id: conversationMessages.id,
          turnId: conversationMessages.turnId,
          sequence: conversationMessages.sequence,
          body: conversationMessages.body,
          createdAt: conversationMessages.createdAt,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversation.id),
            eq(conversationMessages.role, "USER"),
            ne(conversationMessages.status, "HIDDEN"),
            after ? nodesAfterCursor(after) : undefined,
          ),
        )
        .orderBy(asc(conversationMessages.sequence), asc(conversationMessages.id))
        .limit(CONVERSATION_NODE_PAGE_SIZE + 1);
      const hasMore = rows.length > CONVERSATION_NODE_PAGE_SIZE;
      const pageRows = hasMore
        ? rows.slice(0, CONVERSATION_NODE_PAGE_SIZE)
        : rows;
      const last = pageRows.at(-1);
      return {
        items: pageRows.map((row) => ({
          id: row.id,
          turnId: row.turnId,
          sequence: row.sequence,
          summary: summarizeMessage(row.body),
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor:
          hasMore && last
            ? encodeConversationNodeCursor({
                sequence: last.sequence,
                id: last.id,
              })
            : null,
      };
    },
  };
}

async function listVisibleSubagents(
  database: Pick<Database, "select">,
  tenantId: string,
  parentConversationId: string,
): Promise<readonly ConversationSubagentSummary[]> {
  const rows = await database
    .select({
      conversationId: conversations.id,
      name: conversations.subagentName,
      linkStatus: conversations.linkStatus,
      status: conversations.status,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.parentConversationId, parentConversationId),
        eq(conversations.kind, "SUBAGENT"),
        or(
          eq(conversations.linkStatus, "PENDING"),
          eq(conversations.linkStatus, "VERIFIED"),
        ),
      ),
    )
    .orderBy(asc(conversations.createdAt), asc(conversations.id));
  return rows.flatMap((row) =>
    row.name && (row.linkStatus === "PENDING" || row.linkStatus === "VERIFIED")
      ? [
          {
            conversationId: row.conversationId,
            name: row.name,
            linkStatus: row.linkStatus,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
          },
        ]
      : [],
  );
}

export type ConversationHistoryRepository = ReturnType<
  typeof createConversationHistoryRepository
>;

async function requireAccessibleConversation(
  database: Pick<Database, "select">,
  principal: OwnerPrincipal,
  conversationId: string,
) {
  const conversation = await findAccessibleConversation(
    database,
    principal,
    conversationId,
  );
  if (!conversation) throw conversationNotFound();
  return conversation;
}

async function listHistoryPage(
  database: Pick<Database, "select">,
  conversationId: string,
  before?: ConversationHistoryCursor,
): Promise<ConversationHistoryPage> {
  const rows = await database
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        ne(conversationMessages.status, "HIDDEN"),
        before ? historyBeforeCursor(before) : undefined,
      ),
    )
    .orderBy(desc(conversationMessages.sequence), desc(conversationMessages.id))
    .limit(CONVERSATION_HISTORY_PAGE_SIZE + 1);
  const hasMore = rows.length > CONVERSATION_HISTORY_PAGE_SIZE;
  const pageRows = hasMore
    ? rows.slice(0, CONVERSATION_HISTORY_PAGE_SIZE)
    : rows;
  const last = pageRows.at(-1);
  const attachments = await listHistoryAttachments(
    database,
    conversationId,
    pageRows.map(({ id }) => id),
  );
  return {
    items: pageRows
      .reverse()
      .map((message) =>
        toHistoryMessage(message, attachments.get(message.id) ?? []),
      ),
    nextCursor:
      hasMore && last
        ? encodeConversationHistoryCursor({
            sequence: last.sequence,
            id: last.id,
          })
        : null,
  };
}

async function assertHistoryCursor(
  database: Pick<Database, "select">,
  conversationId: string,
  cursor: ConversationHistoryCursor,
): Promise<void> {
  const [anchor] = await database
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.id, cursor.id),
        eq(conversationMessages.sequence, cursor.sequence),
        ne(conversationMessages.status, "HIDDEN"),
      ),
    )
    .limit(1);
  if (!anchor) throw invalidConversationCursor();
}

async function assertNodeCursor(
  database: Pick<Database, "select">,
  conversationId: string,
  cursor: ConversationNodeCursor,
): Promise<void> {
  const [anchor] = await database
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.id, cursor.id),
        eq(conversationMessages.sequence, cursor.sequence),
        eq(conversationMessages.role, "USER"),
        ne(conversationMessages.status, "HIDDEN"),
      ),
    )
    .limit(1);
  if (!anchor) throw invalidConversationCursor();
}

function historyBeforeCursor(cursor: ConversationHistoryCursor) {
  return or(
    lt(conversationMessages.sequence, cursor.sequence),
    and(
      eq(conversationMessages.sequence, cursor.sequence),
      lt(conversationMessages.id, cursor.id),
    ),
  );
}

function nodesAfterCursor(cursor: ConversationNodeCursor) {
  return or(
    gt(conversationMessages.sequence, cursor.sequence),
    and(
      eq(conversationMessages.sequence, cursor.sequence),
      gt(conversationMessages.id, cursor.id),
    ),
  );
}

function toHistoryMessage(
  message: typeof conversationMessages.$inferSelect,
  attachments: readonly ConversationHistoryAttachment[],
): ConversationHistoryMessage {
  if (message.status === "HIDDEN") throw conversationPersistenceFailure();
  return {
    id: message.id,
    turnId: message.turnId,
    sequence: message.sequence,
    role: message.role,
    status: message.status,
    blockId: message.blockId,
    body: message.body,
    attachments,
    stepIndex: message.stepIndex,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

async function listHistoryAttachments(
  database: Pick<Database, "select">,
  conversationId: string,
  messageIds: readonly string[],
): Promise<ReadonlyMap<string, readonly ConversationHistoryAttachment[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await database
    .select({
      id: conversationAttachments.id,
      messageId: conversationAttachments.messageId,
      displayName: conversationAttachments.displayName,
      mediaType: conversationAttachments.declaredMediaType,
      sizeBytes: conversationAttachments.sizeBytes,
    })
    .from(conversationAttachments)
    .where(
      and(
        eq(conversationAttachments.conversationId, conversationId),
        eq(conversationAttachments.status, "BOUND"),
        inArray(conversationAttachments.messageId, messageIds),
      ),
    )
    .orderBy(conversationAttachments.createdAt, conversationAttachments.id);
  const grouped = new Map<string, ConversationHistoryAttachment[]>();
  for (const row of rows) {
    if (!row.messageId) throw conversationPersistenceFailure();
    const attachment = {
      id: row.id,
      displayName: row.displayName,
      mediaType: row.mediaType,
      sizeBytes: row.sizeBytes,
      previewUrl: `/api/attachments/${row.id}`,
      downloadUrl: `/api/attachments/${row.id}?download=1`,
    };
    const existing = grouped.get(row.messageId);
    if (existing) existing.push(attachment);
    else grouped.set(row.messageId, [attachment]);
  }
  return grouped;
}

function summarizeMessage(body: string): string {
  return Array.from(body.trim()).slice(0, 160).join("");
}

function safeCursorNumber(value: bigint | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw conversationPersistenceFailure();
  }
  return parsed;
}
