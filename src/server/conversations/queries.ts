import "server-only";

import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import {
  createConversationRepository,
  type ConversationQueryRepository,
} from "./repository";
import type { PublicConversation } from "./types";

export async function getConversation(
  principal: AuthenticatedPrincipal,
  conversationId: string,
  repository: ConversationQueryRepository = createConversationRepository(),
): Promise<PublicConversation> {
  return repository.getOwnedConversation(principal, conversationId);
}
