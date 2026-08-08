import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import type { EveServiceIdentity } from "./types";

export function serviceIdentity(
  principal: Pick<
    AuthenticatedPrincipal,
    "userId" | "tenantId" | "role" | "source"
  >,
  turn: {
    readonly conversationId: string;
    readonly turnId: string;
    readonly modelConfigVersionId: string;
    readonly agentConfigVersionId: string;
  },
): EveServiceIdentity {
  return {
    userId: principal.userId,
    tenantId: principal.tenantId,
    role: principal.role,
    source: principal.source,
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    modelConfigVersionId: turn.modelConfigVersionId,
    agentConfigVersionId: turn.agentConfigVersionId,
  };
}
