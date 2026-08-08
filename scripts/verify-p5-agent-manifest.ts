import { readFile } from "node:fs/promises";

const manifestPath = ".output/.eve/compile/compiled-agent-manifest.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  readonly disabledFrameworkTools?: readonly string[];
  readonly dynamicSkills?: readonly unknown[];
  readonly dynamicTools?: readonly { readonly logicalPath?: string }[];
  readonly sandbox?: {
    readonly kind?: string;
    readonly logicalPath?: string;
  } | null;
  readonly sandboxWorkspaces?: readonly unknown[];
  readonly skills?: readonly unknown[];
};

const disabled = new Set(manifest.disabledFrameworkTools ?? []);
for (const toolId of [
  "bash",
  "glob",
  "grep",
  "read_file",
  "write_file",
  "web_search",
]) {
  assert(disabled.has(toolId), `受限 Tool ${toolId} 未在编译清单中禁用。`);
}
for (const toolId of ["agent", "ask_question"]) {
  assert(!disabled.has(toolId), `固定 Tool ${toolId} 不应被禁用。`);
}
assert(
  manifest.sandbox?.kind === "eve:disabled-sandbox" &&
    manifest.sandbox.logicalPath === "sandbox.ts",
  "P5 必须通过 agent/sandbox.ts 显式禁用 Sandbox。",
);
assert(
  (manifest.sandboxWorkspaces ?? []).length === 0,
  "P5 不允许配置 Sandbox workspace。",
);
assert((manifest.skills ?? []).length === 0, "P5 不允许静态 Skill。");
assert(
  (manifest.dynamicSkills ?? []).length === 0,
  "P5 不允许 eve 动态 Skill。",
);
assert(
  (manifest.dynamicTools ?? []).some(
    ({ logicalPath }) => logicalPath === "tools/capabilities.ts",
  ),
  "P5 动态能力解析器未进入编译清单。",
);

console.log("P5 Agent 编译能力清单验证通过。");

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
