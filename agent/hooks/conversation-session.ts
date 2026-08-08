import { defineHook } from "eve/hooks";
import {
  parseServiceSessionIdentity,
  recoverConversationSessionMapping,
} from "../../src/server/conversations/session-mapping";

type SessionMappingRecovery = typeof recoverConversationSessionMapping;

export function createConversationSessionHook(
  options: { readonly recoverMapping?: SessionMappingRecovery } = {},
) {
  const recoverMapping =
    options.recoverMapping ?? recoverConversationSessionMapping;
  return defineHook({
    events: {
      async "session.started"(_event, context) {
        if (context.session.parent) return;

        const current = context.session.auth.current;
        const identity = parseServiceSessionIdentity({
          authenticator: current?.authenticator,
          principalId: current?.principalId,
          attributes: current?.attributes,
        });
        await recoverMapping(identity, context.session.id);
      },
    },
  });
}

export default createConversationSessionHook();
