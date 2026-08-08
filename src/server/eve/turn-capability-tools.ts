import { defineTool } from "eve/tools";
import { todo, webFetch } from "eve/tools/defaults";
import { z } from "zod";
import type { ResolvedAgentCapabilities } from "@/src/server/agents/runtime";
import {
  createConversationAttachmentTools,
} from "./dynamic-attachment-tools";
import type { AttachmentToolAuthority } from "../attachments/tool-access";

export function createTurnCapabilityTools(
  capabilities: ResolvedAgentCapabilities,
  attachmentAuthority: AttachmentToolAuthority,
) {
  const enabledTools = new Set(capabilities.toolIds);
  const attachmentTools = createConversationAttachmentTools(
    attachmentAuthority,
  );
  const skillsByName = new Map(
    capabilities.skills.map((skill) => [skill.name, skill] as const),
  );
  const availableSkills = capabilities.skills
    .map((skill) => `${skill.name}: ${skill.description}`)
    .join("\n");

  const tools = {
    ...(enabledTools.has("todo")
      ? {
          todo: defineTool({
            ...todo,
            async execute(input, context) {
              return todo.execute(input, context);
            },
          }),
        }
      : {}),
    ...(enabledTools.has("web_fetch")
      ? {
          web_fetch: defineTool({
            ...webFetch,
            async execute(input, context) {
              return webFetch.execute(input, context);
            },
          }),
        }
      : {}),
    ...(enabledTools.has("list_conversation_attachments")
      ? { list_conversation_attachments: attachmentTools.list }
      : {}),
    ...(enabledTools.has("read_conversation_attachment")
      ? { read_conversation_attachment: attachmentTools.read }
      : {}),
    ...(capabilities.skills.length > 0
      ? {
          load_skill: defineTool({
            description: `按需加载当前 Turn 已启用的 Skill 指令。可用 Skill：\n${availableSkills}`,
            inputSchema: z.object({
              name: z.string().refine((name) => skillsByName.has(name), {
                message: "Skill is not enabled for this turn.",
              }),
            }),
            async execute({ name }) {
              const skill = skillsByName.get(name);
              if (!skill) {
                throw new Error("Skill is not enabled for this turn.");
              }
              return {
                name: skill.name,
                version: skill.version,
                markdown: skill.markdown,
              };
            },
          }),
        }
      : {}),
  };

  return Object.keys(tools).length > 0 ? tools : null;
}
