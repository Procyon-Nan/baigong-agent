import type { LanguageModel } from "ai";

class ModelNotConfiguredError extends Error {
  constructor() {
    super("No model is configured. Configure a provider and model in the administration interface.");
    this.name = "ModelNotConfiguredError";
  }
}

export const unconfiguredModel = {
  specificationVersion: "v4",
  provider: "baigong.internal",
  modelId: "unconfigured",
  supportedUrls: {},
  async doGenerate() {
    throw new ModelNotConfiguredError();
  },
  async doStream() {
    throw new ModelNotConfiguredError();
  },
} satisfies LanguageModel;
