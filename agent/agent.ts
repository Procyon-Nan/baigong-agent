import { defineAgent } from "eve";
import { unconfiguredModel } from "./unconfigured-model";

export default defineAgent({
  model: unconfiguredModel,
  modelContextWindowTokens: 1,
});
