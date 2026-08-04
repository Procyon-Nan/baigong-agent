import "server-only";

import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import {
  decodeConversationCursor,
  decodeHistoryCursor,
  decodeNodeCursor,
} from "./conversation-cursors";
import {
  createConversationHistoryRepository,
  type ConversationHistoryPage,
  type ConversationHistoryRepository,
  type ConversationNodePage,
  type ConversationSnapshot,
} from "./history";
import {
  createConversationListingRepository,
  type ConversationListingRepository,
  type ConversationListPage,
} from "./listing";
import {
  createConversationManagementRepository,
  type ConversationManagementRepository,
} from "./management";
import type { PublicConversation } from "./types";

export { cancelConversationTurn } from "./cancellation";
export { continueConversation } from "./continuation";
export { createConversation } from "./creation";
export {
  archiveAdminConversation,
  getAdminConversationAuditDetails,
  getAdminConversationExecutionIndex,
  listAdminConversations,
} from "./admin-conversation-service";
export { applyConversationEvent, monitorEveEvents } from "./lifecycle";
export { getConversation } from "./queries";
export {
  reconcileConversation,
  reconcilePendingConversations,
} from "./reconciliation";

export async function listConversations(
  principal: AuthenticatedPrincipal,
  input: { readonly archived: boolean; readonly cursor?: string },
  repository: ConversationListingRepository =
    createConversationListingRepository(),
): Promise<ConversationListPage> {
  return repository.listMainPage(principal, {
    archived: input.archived,
    before: decodeConversationCursor(input.cursor),
  });
}

export async function getConversationSnapshot(
  principal: AuthenticatedPrincipal,
  conversationId: string,
  input: { readonly cursor?: string } = {},
  repository: ConversationHistoryRepository =
    createConversationHistoryRepository(),
): Promise<ConversationSnapshot> {
  return repository.getSnapshot(
    principal,
    conversationId,
    decodeHistoryCursor(input.cursor),
  );
}

export async function listConversationMessages(
  principal: AuthenticatedPrincipal,
  conversationId: string,
  input: { readonly cursor?: string } = {},
  repository: ConversationHistoryRepository =
    createConversationHistoryRepository(),
): Promise<ConversationHistoryPage> {
  return repository.listMessages(
    principal,
    conversationId,
    decodeHistoryCursor(input.cursor),
  );
}

export async function listConversationUserMessageNodes(
  principal: AuthenticatedPrincipal,
  conversationId: string,
  input: { readonly cursor?: string } = {},
  repository: ConversationHistoryRepository =
    createConversationHistoryRepository(),
): Promise<ConversationNodePage> {
  return repository.listUserMessageNodes(
    principal,
    conversationId,
    decodeNodeCursor(input.cursor),
  );
}

export async function renameConversation(
  principal: AuthenticatedPrincipal,
  conversationId: string,
  title: string,
  repository: ConversationManagementRepository =
    createConversationManagementRepository(),
): Promise<PublicConversation> {
  return repository.rename(principal, conversationId, title);
}

export async function archiveConversation(
  principal: AuthenticatedPrincipal,
  conversationId: string,
  repository: ConversationManagementRepository =
    createConversationManagementRepository(),
): Promise<PublicConversation> {
  return repository.archive(principal, conversationId);
}

export async function restoreConversation(
  principal: AuthenticatedPrincipal,
  conversationId: string,
  repository: ConversationManagementRepository =
    createConversationManagementRepository(),
): Promise<PublicConversation> {
  return repository.restore(principal, conversationId);
}

export type {
  ConversationSubmission,
  ConversationSubmissionResponse,
  EveGateway,
  PublicConversation,
  PublicConversationTurn,
} from "./types";
