"use client";

import { Pencil, Plus, Save, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useAdminRequest } from "@/app/admin/use-admin-request";
import styles from "./agent-capabilities.module.css";

type Capabilities = {
  readonly agent: {
    readonly id: string;
    readonly stableKey: string;
    readonly versionId: string;
    readonly version: number;
  };
  readonly fixedTools: readonly string[];
  readonly fixedDisabledTools: readonly string[];
  readonly dynamicTools: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly defaultEnabled: boolean;
  }[];
  readonly enabledToolIds: readonly string[];
  readonly skills: readonly {
    readonly id: string;
    readonly versionId: string;
    readonly version: number;
    readonly name: string;
    readonly description: string;
    readonly createdSource: "SYSTEM" | "ADMIN" | "AGENT";
    readonly enabled: boolean;
    readonly updatedAt: string;
  }[];
  readonly updatedAt: string;
  readonly updatedByUserId: string | null;
};

type Skill = {
  readonly id: string;
  readonly name: string;
  readonly createdSource: "SYSTEM" | "ADMIN" | "AGENT";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly enabled: boolean;
  readonly currentVersion: {
    readonly id: string;
    readonly version: number;
    readonly name: string;
    readonly description: string;
    readonly markdown: string;
    readonly createdSource: "SYSTEM" | "ADMIN" | "AGENT";
    readonly createdAt: string;
  };
  readonly versions: readonly {
    readonly id: string;
    readonly version: number;
    readonly name: string;
    readonly description: string;
    readonly createdSource: "SYSTEM" | "ADMIN" | "AGENT";
    readonly createdAt: string;
  }[];
};

type SkillForm = {
  readonly skillId: string | null;
  readonly name: string;
  readonly description: string;
  readonly markdown: string;
};

const emptySkillForm: SkillForm = {
  skillId: null,
  name: "",
  description: "",
  markdown: "",
};

export function AgentCapabilitiesManager({
  capabilities,
  skills,
}: {
  readonly capabilities: Capabilities;
  readonly skills: readonly Skill[];
}) {
  const { error, pending, request } = useAdminRequest();
  const [enabledToolIds, setEnabledToolIds] = useState(
    () => new Set(capabilities.enabledToolIds),
  );
  const [enabledSkillIds, setEnabledSkillIds] = useState(
    () => new Set(skills.filter(({ enabled }) => enabled).map(({ id }) => id)),
  );
  const [skillForm, setSkillForm] = useState<SkillForm>(emptySkillForm);

  useEffect(() => {
    setEnabledToolIds(new Set(capabilities.enabledToolIds));
    setEnabledSkillIds(
      new Set(skills.filter(({ enabled }) => enabled).map(({ id }) => id)),
    );
  }, [capabilities, skills]);

  async function saveCapabilities() {
    await request("/api/admin/agent-capabilities", {
      method: "PUT",
      body: JSON.stringify({
        toolIds: [...enabledToolIds].sort(),
        skillVersionIds: skills
          .filter((skill) => enabledSkillIds.has(skill.id))
          .map((skill) => skill.currentVersion.id)
          .sort(),
      }),
    });
  }

  async function saveSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = skillForm.skillId
      ? `/api/admin/skills/${skillForm.skillId}`
      : "/api/admin/skills";
    const result = await request(path, {
      method: skillForm.skillId ? "PUT" : "POST",
      body: JSON.stringify({
        name: skillForm.name,
        description: skillForm.description,
        markdown: skillForm.markdown,
      }),
    });
    if (result) setSkillForm(emptySkillForm);
  }

  function editSkill(skill: Skill) {
    setSkillForm({
      skillId: skill.id,
      name: skill.currentVersion.name,
      description: skill.currentVersion.description,
      markdown: skill.currentVersion.markdown,
    });
  }

  return (
    <div className={styles.layout}>
      <main className={styles.mainColumn}>
        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>固定能力</h2>
              <p>固定能力不进入版本开关，不能在管理页面修改。</p>
            </div>
          </div>
          <div className={styles.boundaryGrid}>
            <BoundaryList
              items={capabilities.fixedTools}
              label="固定开启"
              tone="enabled"
            />
            <BoundaryList
              items={capabilities.fixedDisabledTools}
              label="固定禁用"
              tone="disabled"
            />
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>动态 Tool</h2>
              <p>保存后从同一会话的下一 Turn 起生效。</p>
            </div>
          </div>
          <div className={styles.optionList}>
            {capabilities.dynamicTools.map((tool) => (
              <label className={styles.option} key={tool.id}>
                <input
                  checked={enabledToolIds.has(tool.id)}
                  onChange={() =>
                    setEnabledToolIds(toggleSet(enabledToolIds, tool.id))
                  }
                  type="checkbox"
                />
                <span>
                  <strong>{tool.name}</strong>
                  <small>
                    {tool.id} · {tool.description}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>数据库 Markdown Skill</h2>
              <p>
                编辑创建不可变新版本；Skill 定义和历史版本不提供删除，不再使用时请关闭启用状态并保存能力版本。
              </p>
            </div>
          </div>
          <div className={styles.optionList}>
            {skills.map((skill) => (
              <div className={styles.skillRow} key={skill.id}>
                <label className={styles.option}>
                  <input
                    checked={enabledSkillIds.has(skill.id)}
                    onChange={() =>
                      setEnabledSkillIds(toggleSet(enabledSkillIds, skill.id))
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>{skill.name}</strong>
                    <small>
                      v{skill.currentVersion.version} · {skill.createdSource} · {skill.currentVersion.description}
                    </small>
                  </span>
                </label>
                <button
                  aria-label={`编辑 ${skill.name}`}
                  className={styles.iconButton}
                  onClick={() => editSkill(skill)}
                  title="创建新版本"
                  type="button"
                >
                  <Pencil aria-hidden="true" size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <button
          className={styles.primaryButton}
          disabled={Boolean(pending)}
          onClick={saveCapabilities}
          type="button"
        >
          <Save aria-hidden="true" size={16} />
          保存能力版本
        </button>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </main>

      <aside className={styles.panel}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>{skillForm.skillId ? "编辑 Skill" : "创建 Skill"}</h2>
            <p>
              {skillForm.skillId
                ? "保存后创建新版本；若当前已启用，将自动切换到新版本。"
                : "新建 Skill 默认不启用。"}
            </p>
          </div>
          {skillForm.skillId ? (
            <button
              aria-label="取消编辑"
              className={styles.iconButton}
              onClick={() => setSkillForm(emptySkillForm)}
              type="button"
            >
              <X aria-hidden="true" size={15} />
            </button>
          ) : null}
        </div>
        <form className={styles.form} onSubmit={saveSkill}>
          <label>
            <span>名称</span>
            <input
              maxLength={80}
              onChange={(event) =>
                setSkillForm({ ...skillForm, name: event.target.value })
              }
              pattern="[a-z][a-z0-9_]*"
              placeholder="research_playbook"
              required
              value={skillForm.name}
            />
          </label>
          <label>
            <span>触发说明</span>
            <textarea
              maxLength={500}
              onChange={(event) =>
                setSkillForm({ ...skillForm, description: event.target.value })
              }
              required
              value={skillForm.description}
            />
          </label>
          <label>
            <span>Markdown 正文</span>
            <textarea
              className={styles.markdownEditor}
              maxLength={100_000}
              onChange={(event) =>
                setSkillForm({ ...skillForm, markdown: event.target.value })
              }
              required
              value={skillForm.markdown}
            />
          </label>
          <button
            className={styles.primaryButton}
            disabled={Boolean(pending)}
            type="submit"
          >
            {skillForm.skillId ? (
              <Save aria-hidden="true" size={16} />
            ) : (
              <Plus aria-hidden="true" size={16} />
            )}
            {skillForm.skillId ? "创建新版本" : "创建 Skill"}
          </button>
        </form>
      </aside>
    </div>
  );
}

function BoundaryList({
  items,
  label,
  tone,
}: {
  readonly items: readonly string[];
  readonly label: string;
  readonly tone: "enabled" | "disabled";
}) {
  return (
    <div>
      <h3>{label}</h3>
      <div className={styles.badgeList}>
        {items.map((item) => (
          <span className={styles[tone]} key={item}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function toggleSet(values: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
