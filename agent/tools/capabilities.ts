import { defineDynamic } from "eve/tools";
import { resolveAgentCapabilityVersion } from "../../src/server/agents/runtime";
import { createTurnCapabilityTools } from "../../src/server/eve/turn-capability-tools";

export default defineDynamic({
  events: {
    "turn.started": async (_event, context) => {
      const attributes = context.session.auth.current?.attributes;
      const userId = context.session.auth.current?.principalId;
      const tenantId = attributes?.tenantId;
      const source = attributes?.source;
      const conversationId = attributes?.conversationId;
      const modelConfigVersionId = attributes?.modelConfigVersionId;
      const agentConfigVersionId = attributes?.agentConfigVersionId;
      if (
        typeof userId !== "string" ||
        typeof tenantId !== "string" ||
        (source !== "LOCAL" && source !== "EMBEDDED") ||
        typeof conversationId !== "string" ||
        typeof modelConfigVersionId !== "string" ||
        typeof agentConfigVersionId !== "string"
      ) {
        return null;
      }

      const capabilities = await resolveAgentCapabilityVersion(
        tenantId,
        agentConfigVersionId,
      );
      return createTurnCapabilityTools(capabilities, {
        tenantId,
        userId,
        source,
        conversationId,
        modelConfigVersionId,
      });
    },
  },
});
