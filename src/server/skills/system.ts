export const EVIDENCE_RESEARCH_SKILL_NAME = "evidence_research";
export const EVIDENCE_RESEARCH_SKILL_DESCRIPTION =
  "在回答需要事实依据、来源核对或材料比较的问题时加载。";
export const EVIDENCE_RESEARCH_SKILL_MARKDOWN = `# 证据研究

回答前先判断当前问题是否需要证据，以及需要哪些类型的证据。

- 优先读取当前会话附件、已启用的网页 Tool 或外部知识 Tool。
- 明确区分 Tool 返回结果、用户提供材料和模型自身知识。
- 对无法验证、证据冲突或材料不足的部分明确说明不确定性。
- 保留对实际读取来源的可理解引用，不得虚构或暗示读取过未读取的来源。
- 本 Skill 只提供工作方法，不扩大身份、Tool、附件或知识源访问权限。
`;
