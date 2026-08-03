import { defineHook } from "eve/hooks";
import {
  parseServiceSessionIdentity,
  recoverConversationSessionMapping,
} from "../../src/server/conversations/session-mapping";

export default defineHook({
  events: {
    async "session.started"(_event, context) {
      const current = context.session.auth.current;
      const identity = parseServiceSessionIdentity({
        authenticator: current?.authenticator,
        principalId: current?.principalId,
        attributes: current?.attributes,
      });
      await recoverConversationSessionMapping(identity, context.session.id);
    },
  },
});
