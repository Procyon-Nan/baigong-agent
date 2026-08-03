import { defineAgent, defineDynamic } from "eve";
import { resolveRuntimeModel } from "../src/server/models/runtime";
import { unconfiguredModel } from "./unconfigured-model";

export default defineAgent({
  model: defineDynamic({
    fallback: unconfiguredModel,
    events: {
      "step.started": async (_event, context) => {
        const attributes = context.session.auth.current?.attributes;
        const tenantId = attributes?.tenantId;
        const modelConfigVersionId = attributes?.modelConfigVersionId;
        if (
          typeof tenantId !== "string" ||
          typeof modelConfigVersionId !== "string"
        ) {
          return null;
        }

        const runtime = await resolveRuntimeModel(
          tenantId,
          modelConfigVersionId,
        );
        return runtime.configuration.contextWindowTokens
          ? {
              model: runtime.model,
              modelContextWindowTokens:
                runtime.configuration.contextWindowTokens,
            }
          : { model: runtime.model };
      },
    },
  }),
  modelContextWindowTokens: 1,
});
