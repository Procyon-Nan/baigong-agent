import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApplicationFrame } from "@/app/components/application-frame";
import {
  isAdminPrincipal,
  resolvePrincipal,
} from "@/src/server/authorization";
import { getCurrentAgentCapabilities } from "@/src/server/agents/service";
import { listSkills } from "@/src/server/skills/service";
import { AgentCapabilitiesManager } from "./agent-capabilities-manager";
import styles from "./agent-capabilities.module.css";

export const dynamic = "force-dynamic";

export default async function AgentCapabilitiesPage() {
  const principal = await resolvePrincipal(new Headers(await headers()));
  if (!principal) redirect("/login");
  if (principal.mustChangePassword) redirect("/change-password");
  if (!isAdminPrincipal(principal)) redirect("/settings");

  const [capabilities, skills] = await Promise.all([
    getCurrentAgentCapabilities(principal),
    listSkills(principal),
  ]);
  return (
    <ApplicationFrame
      contentWidth="wide"
      navigationMode="admin"
      user={{ displayName: principal.displayName, role: principal.role }}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>主 Agent</p>
          <h1>Agent 能力</h1>
          <p>管理从下一 Turn 起生效的动态 Tool 与数据库 Markdown Skill。</p>
        </div>
        <span className={styles.version}>版本 {capabilities.agent.version}</span>
      </header>
      <AgentCapabilitiesManager
        capabilities={{
          ...capabilities,
          updatedAt: capabilities.updatedAt.toISOString(),
          skills: capabilities.skills.map((skill) => ({
            ...skill,
            updatedAt: skill.updatedAt.toISOString(),
          })),
        }}
        skills={skills.map((skill) => ({
          ...skill,
          createdAt: skill.createdAt.toISOString(),
          updatedAt: skill.updatedAt.toISOString(),
          currentVersion: {
            ...skill.currentVersion,
            createdAt: skill.currentVersion.createdAt.toISOString(),
          },
          versions: skill.versions.map((version) => ({
            ...version,
            createdAt: version.createdAt.toISOString(),
          })),
        }))}
      />
    </ApplicationFrame>
  );
}
