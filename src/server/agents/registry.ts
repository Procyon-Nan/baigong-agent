export const MAIN_AGENT_STABLE_KEY = "main";
export const FIXED_AGENT_TOOLS = ["agent", "ask_question"] as const;
export const DYNAMIC_AGENT_TOOL_IDS = [
  "todo",
  "web_fetch",
  "list_conversation_attachments",
  "read_conversation_attachment",
] as const;
export const DEFAULT_DYNAMIC_AGENT_TOOL_IDS = [
  "todo",
  "list_conversation_attachments",
  "read_conversation_attachment",
] as const satisfies readonly DynamicAgentToolId[];
export const FIXED_DISABLED_AGENT_TOOLS = [
  "web_search",
  "bash",
  "read_file",
  "write_file",
  "glob",
  "grep",
] as const;

export type DynamicAgentToolId = (typeof DYNAMIC_AGENT_TOOL_IDS)[number];

export type DynamicToolDefinition = {
  readonly id: DynamicAgentToolId;
  readonly name: string;
  readonly description: string;
  readonly defaultEnabled: boolean;
};

const DEFAULT_TOOL_IDS = new Set<string>(DEFAULT_DYNAMIC_AGENT_TOOL_IDS);

export const dynamicToolRegistry: readonly DynamicToolDefinition[] = [
  {
    id: "todo",
    name: "任务清单",
    description: "维护当前 eve 会话的持久任务清单。",
    defaultEnabled: true,
  },
  {
    id: "web_fetch",
    name: "网页读取",
    description: "读取符合 eve 公开 HTTPS 安全策略的网页。",
    defaultEnabled: false,
  },
  {
    id: "list_conversation_attachments",
    name: "列出会话附件",
    description: "列出当前根会话中允许读取的附件。",
    defaultEnabled: true,
  },
  {
    id: "read_conversation_attachment",
    name: "读取会话附件",
    description: "读取当前根会话中一个已授权附件。",
    defaultEnabled: true,
  },
] as const;

export function isDynamicAgentToolId(value: string): value is DynamicAgentToolId {
  return DYNAMIC_AGENT_TOOL_IDS.some((toolId) => toolId === value);
}

export function defaultDynamicToolIds(): readonly DynamicAgentToolId[] {
  return DYNAMIC_AGENT_TOOL_IDS.filter((toolId) => DEFAULT_TOOL_IDS.has(toolId));
}
