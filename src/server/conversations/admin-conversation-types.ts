import type {
  ConversationKind,
  ConversationLinkStatus,
  ConversationStatus,
} from "@/src/server/db/schema";
import type { IdentitySource } from "@/src/server/domain/identity";
import type { ConversationHistoryPage } from "./history";
import type { PublicConversation } from "./types";
import type { ConversationUsageSummary } from "./usage-repository";

export type AdminConversationArchiveFilter = "all" | "active" | "archived";

export type AdminConversationFilters = {
  readonly ownerUserId?: string;
  readonly ownerSource?: IdentitySource;
  readonly status?: ConversationStatus;
  readonly archived: AdminConversationArchiveFilter;
};

export type AdminConversationOwner = {
  readonly userId: string;
  readonly displayName: string;
  readonly identifier: string;
  readonly source: IdentitySource;
};

export type AdminConversationListItem = PublicConversation & {
  readonly owner: AdminConversationOwner;
};

export type AdminConversationListPage = {
  readonly items: readonly AdminConversationListItem[];
  readonly nextCursor: string | null;
};

export type AdminConversationTarget = {
  readonly conversation: PublicConversation & {
    readonly kind: ConversationKind;
    readonly linkStatus: ConversationLinkStatus;
    readonly parentConversationId: string | null;
    readonly subagentName: string | null;
  };
  readonly owner: AdminConversationOwner;
};

export type AdminSubagentIndexEntry = {
  readonly conversationId: string;
  readonly parentConversationId: string;
  readonly name: string;
  readonly status: ConversationStatus;
  readonly linkStatus: ConversationLinkStatus;
  readonly depth: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AdminConversationAuditDetails = AdminConversationTarget & {
  readonly messages: ConversationHistoryPage;
  readonly hasMoreHistory: boolean;
  readonly lastEveCursor: number | null;
  readonly tokenUsage: ConversationUsageSummary | null;
  readonly subagents: readonly AdminSubagentIndexEntry[];
};
