import "server-only";

import type { AdminPrincipal } from "@/src/server/auth/principal";
import {
  decodeAdminConversationActionCursor,
  decodeAdminConversationListCursor,
  encodeAdminConversationActionCursor,
} from "./admin-conversation-cursors";
import { decodeHistoryCursor } from "./conversation-cursors";
import {
  adminConversationFilterKey,
  createAdminConversationListingRepository,
  type AdminConversationListingRepository,
} from "./admin-conversation-listing";
import {
  createAdminConversationRepository,
  type AdminConversationRepository,
} from "./admin-conversation-repository";
import type {
  AdminConversationAuditDetails,
  AdminConversationFilters,
  AdminConversationListPage,
  AdminConversationTarget,
  AdminSubagentIndexEntry,
} from "./admin-conversation-types";
import {
  createConversationActionAuditRepository,
  type ConversationActionIndexEntry,
  type ConversationActionIndexPage,
} from "./action-audit-repository";
import { conversationNotFound } from "./errors";
import {
  createConversationHistoryRepository,
  type ConversationHistoryRepository,
} from "./history";
import {
  createConversationUsageRepository,
  type ConversationUsageSummary,
} from "./usage-repository";

const ADMIN_ACTION_PAGE_SIZE = 50;

export type AdminConversationExecutionIndex = {
  readonly tokenUsage: ConversationUsageSummary | null;
  readonly actions: {
    readonly items: readonly AdminConversationActionEntry[];
    readonly nextCursor: string | null;
  };
  readonly subagents: readonly AdminSubagentIndexEntry[];
};

export type AdminConversationActionEntry = Omit<
  ConversationActionIndexEntry,
  "startedAt" | "completedAt"
> & {
  readonly startedAt: string;
  readonly completedAt: string | null;
};

export async function listAdminConversations(
  principal: AdminPrincipal,
  input: AdminConversationFilters & { readonly cursor?: string },
  repository: AdminConversationListingRepository =
    createAdminConversationListingRepository(),
): Promise<AdminConversationListPage> {
  const filters: AdminConversationFilters = {
    ownerUserId: input.ownerUserId,
    ownerSource: input.ownerSource,
    status: input.status,
    archived: input.archived,
  };
  const before = decodeAdminConversationListCursor(
    input.cursor,
    adminConversationFilterKey(filters),
  );
  return repository.listMainPage(principal, filters, before);
}

export async function getAdminConversationAuditDetails(
  principal: AdminPrincipal,
  conversationId: string,
  input: { readonly cursor?: string } = {},
  dependencies: {
    readonly repository?: AdminConversationRepository;
    readonly historyRepository?: ConversationHistoryRepository;
  } = {},
): Promise<AdminConversationAuditDetails> {
  const repository =
    dependencies.repository ?? createAdminConversationRepository();
  const target = await requireTarget(repository, principal, conversationId);
  const [snapshot, subagents] = await Promise.all([
    (
      dependencies.historyRepository ?? createConversationHistoryRepository()
    ).getSnapshot(
      {
        tenantId: principal.tenantId,
        userId: target.owner.userId,
        source: target.owner.source,
      },
      conversationId,
      decodeHistoryCursor(input.cursor),
    ),
    repository.listSubagentTree(principal.tenantId, conversationId),
  ]);
  await repository.recordViewed(principal, target);
  return {
    ...target,
    messages: snapshot.messages,
    hasMoreHistory: snapshot.hasMoreHistory,
    lastEveCursor: snapshot.lastEveCursor,
    tokenUsage: snapshot.tokenUsage,
    subagents,
  };
}

export async function getAdminConversationExecutionIndex(
  principal: AdminPrincipal,
  conversationId: string,
  input: { readonly cursor?: string } = {},
  dependencies: {
    readonly repository?: AdminConversationRepository;
    readonly actionRepository?: {
      listPage(
        tenantId: string,
        targetConversationId: string,
        actionInput: {
          readonly limit: number;
          readonly before?: {
            readonly requestEveCursor: number;
            readonly id: string;
          };
        },
      ): Promise<ConversationActionIndexPage>;
    };
    readonly usageRepository?: {
      getSummary(
        tenantId: string,
        targetConversationId: string,
      ): Promise<ConversationUsageSummary | null>;
    };
  } = {},
): Promise<AdminConversationExecutionIndex> {
  const repository =
    dependencies.repository ?? createAdminConversationRepository();
  const target = await requireTarget(repository, principal, conversationId);
  const [actions, tokenUsage, subagents] = await Promise.all([
    (
      dependencies.actionRepository ??
      createConversationActionAuditRepository()
    ).listPage(principal.tenantId, conversationId, {
      limit: ADMIN_ACTION_PAGE_SIZE,
      before: decodeAdminConversationActionCursor(input.cursor),
    }),
    (
      dependencies.usageRepository ?? createConversationUsageRepository()
    ).getSummary(principal.tenantId, conversationId),
    repository.listSubagentTree(principal.tenantId, conversationId),
  ]);
  await repository.recordExecutionIndexViewed(principal, target);
  return {
    tokenUsage,
    actions: {
      items: actions.items.map(toAdminActionEntry),
      nextCursor: actions.nextCursor
        ? encodeAdminConversationActionCursor(actions.nextCursor)
        : null,
    },
    subagents,
  };
}

export async function archiveAdminConversation(
  principal: AdminPrincipal,
  conversationId: string,
  repository: AdminConversationRepository =
    createAdminConversationRepository(),
): Promise<AdminConversationTarget> {
  return repository.archiveMain(principal, conversationId);
}

async function requireTarget(
  repository: AdminConversationRepository,
  principal: AdminPrincipal,
  conversationId: string,
): Promise<AdminConversationTarget> {
  const target = await repository.findTarget(principal, conversationId);
  if (!target) throw conversationNotFound();
  return target;
}

function toAdminActionEntry(
  entry: ConversationActionIndexEntry,
): AdminConversationActionEntry {
  return {
    ...entry,
    startedAt: entry.startedAt.toISOString(),
    completedAt: entry.completedAt?.toISOString() ?? null,
  };
}
