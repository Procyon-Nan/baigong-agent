import type { HandleMessageStreamEvent } from "eve/client";
import type { UserContent } from "ai";
import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import { MAIN_AGENT_STABLE_KEY } from "@/src/server/agents/registry";
import type {
  ConversationKind,
  ConversationLinkStatus,
  ConversationStatus,
  ConversationTurnStatus,
} from "@/src/server/db/schema";

export const MAIN_AGENT_ID = MAIN_AGENT_STABLE_KEY;
export const MAX_ACTIVE_MAIN_TURNS_PER_USER = 3;
export const MAX_ACTIVE_SUBAGENT_TURNS_PER_PARENT_TURN = 6;
export const MAX_MAIN_CONVERSATIONS_PER_USER = 50;
export const CONVERSATION_LIST_PAGE_SIZE = 10;

export type PublicConversationTurn = {
  readonly id: string;
  readonly status: ConversationTurnStatus;
};

export type PublicConversation = {
  readonly id: string;
  readonly title: string;
  readonly status: ConversationStatus;
  readonly activeTurn: PublicConversationTurn | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ConversationSubmissionResponse = {
  readonly conversation: PublicConversation;
  readonly turn: PublicConversationTurn;
  readonly duplicate: boolean;
};

export type ConversationSubmission = ConversationSubmissionResponse & {
  readonly monitor: (() => Promise<void>) | null;
};

export type EveServiceIdentity = Pick<
  AuthenticatedPrincipal,
  "userId" | "tenantId" | "role" | "source"
> & {
  readonly conversationId: string;
  readonly turnId: string;
  readonly modelConfigVersionId: string;
  readonly agentConfigVersionId: string;
};

export type EveAcceptedTurn = {
  readonly sessionId: string;
  readonly continuationToken: string | null;
  readonly events: AsyncIterable<HandleMessageStreamEvent>;
};

export type EveGateway = {
  startTurn(input: {
    readonly identity: EveServiceIdentity;
    readonly message: string | UserContent;
  }): Promise<EveAcceptedTurn>;
  continueTurn(input: {
    readonly identity: EveServiceIdentity;
    readonly sessionId: string;
    readonly continuationToken: string;
    readonly streamIndex: number;
    readonly message: string | UserContent;
  }): Promise<EveAcceptedTurn>;
  cancelTurn(input: {
    readonly identity: EveServiceIdentity;
    readonly sessionId: string;
    readonly eveTurnId?: string;
  }): Promise<"accepted" | "no_active_turn">;
  streamSession(input: {
    readonly identity: EveServiceIdentity;
    readonly sessionId: string;
    readonly startIndex: number;
    readonly follow?: boolean;
    readonly signal?: AbortSignal;
  }): AsyncIterable<HandleMessageStreamEvent>;
};

export type ReservedConversationTurn = {
  readonly conversationId: string;
  readonly turnId: string;
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly ownerSource: AuthenticatedPrincipal["source"];
  readonly modelConfigVersionId: string;
  readonly agentConfigVersionId: string;
  readonly eveTurnId: string | null;
  readonly conversationStatus: ConversationStatus;
  readonly turnStatus: ConversationTurnStatus;
  readonly eveSessionId: string | null;
  readonly encryptedContinuationToken: string | null;
  readonly continuationTokenRevision: number;
  readonly nextStreamIndex: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type TurnReservation =
  | {
      readonly kind: "reserved";
      readonly value: ReservedConversationTurn;
      readonly message: string;
      readonly attachments: readonly ReservedConversationAttachment[];
    }
  | { readonly kind: "duplicate"; readonly value: ReservedConversationTurn };

export type ReservedConversationAttachment = {
  readonly id: string;
  readonly storageKey: string;
  readonly displayName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
};

export type CancellationReservation =
  | { readonly kind: "no_active_turn" }
  | {
      readonly kind: "reserved";
      readonly value: ReservedConversationTurn & {
        readonly eveSessionId: string;
      };
      readonly administeredForAnotherUser: boolean;
    };

export type RuntimeConversation = ReservedConversationTurn & {
  readonly role: AuthenticatedPrincipal["role"];
  readonly kind: ConversationKind;
  readonly linkStatus: ConversationLinkStatus;
  readonly parentConversationId: string | null;
};
