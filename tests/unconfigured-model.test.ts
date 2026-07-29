import { describe, expect, it } from "vitest";
import { unconfiguredModel } from "@/agent/unconfigured-model";

describe("unconfigured model", () => {
  it("fails closed without calling a provider", async () => {
    await expect(unconfiguredModel.doGenerate()).rejects.toMatchObject({
      name: "ModelNotConfiguredError",
    });
    await expect(unconfiguredModel.doStream()).rejects.toMatchObject({
      name: "ModelNotConfiguredError",
    });
  });
});
