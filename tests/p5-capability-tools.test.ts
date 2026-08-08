import type { ToolContext } from "eve/tools";
import { describe, expect, it } from "vitest";
import type { ResolvedAgentCapabilities } from "@/src/server/agents/runtime";
import { createTurnCapabilityTools } from "@/src/server/eve/turn-capability-tools";

const authority = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  userId: "p5-capability-user",
  source: "LOCAL",
  conversationId: "00000000-0000-4000-8000-000000000002",
  modelConfigVersionId: "00000000-0000-4000-8000-000000000003",
} as const;

describe("P5 turn capability tools", () => {
  it("returns no dynamic tools when the locked version has no capabilities", () => {
    expect(createTurnCapabilityTools(capabilities(), authority)).toBeNull();
  });

  it("exposes attachment tools independently of todo and skills", () => {
    const tools = createTurnCapabilityTools(
      capabilities({ toolIds: ["list_conversation_attachments"] }),
      authority,
    );
    expect(Object.keys(tools ?? {})).toEqual([
      "list_conversation_attachments",
    ]);
  });

  it("loads only the skill versions locked by the turn", async () => {
    const tools = createTurnCapabilityTools(
      capabilities({
        skills: [
          {
            skillId: "00000000-0000-4000-8000-000000000010",
            versionId: "00000000-0000-4000-8000-000000000011",
            version: 3,
            name: "locked_skill",
            description: "锁定版本测试",
            markdown: "# Locked\n\n第三版内容。",
          },
        ],
      }),
      authority,
    );
    expect(Object.keys(tools ?? {})).toEqual(["load_skill"]);
    await expect(
      tools!.load_skill!.execute(
        { name: "locked_skill" },
        {} as ToolContext,
      ),
    ).resolves.toEqual({
      name: "locked_skill",
      version: 3,
      markdown: "# Locked\n\n第三版内容。",
    });
    await expect(
      tools!.load_skill!.execute(
        { name: "unavailable_skill" },
        {} as ToolContext,
      ),
    ).rejects.toThrow("Skill is not enabled for this turn.");
  });
});

function capabilities(
  overrides: Partial<ResolvedAgentCapabilities> = {},
): ResolvedAgentCapabilities {
  return {
    agentId: "00000000-0000-4000-8000-000000000004",
    configVersionId: "00000000-0000-4000-8000-000000000005",
    version: 1,
    toolIds: [],
    skills: [],
    ...overrides,
  };
}
