import {
  Cable,
  Database,
  FolderKey,
  ServerCog,
  type LucideIcon,
} from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApplicationFrame } from "@/app/components/application-frame";
import { ReloadButton } from "@/app/components/reload-button";
import { StatusIndicator } from "@/app/components/status-indicator";
import { inspectApplicationReadiness } from "@/src/server/readiness";
import { resolvePrincipal } from "@/src/server/authorization";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const principal = await resolvePrincipal(new Headers(await headers()));
  if (!principal) redirect("/login");
  if (principal.mustChangePassword) redirect("/change-password");
  if (principal.role !== "ADMIN") redirect("/settings");

  const readiness = await inspectApplicationReadiness();
  const checkedAt = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(readiness.checkedAt));

  return (
    <ApplicationFrame
      navigationMode="admin"
      user={{ displayName: principal.displayName, role: principal.role }}
    >
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>系统初始化</span>
          <h1 className={styles.title}>运行环境</h1>
        </div>
        <div className={styles.topbarActions}>
          <span className={styles.lastChecked}>检查于 {checkedAt}</span>
          <ReloadButton />
        </div>
      </header>

      <section
        className={styles.statusSection}
        aria-labelledby="service-status-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 className={styles.sectionTitle} id="service-status-title">
              服务状态
            </h2>
            <p className={styles.sectionDescription}>
              基础设施就绪后，身份认证与管理配置才能启用。
            </p>
          </div>
        </div>

        <div className={styles.statusList}>
          <StatusRow
            description="Next.js 与 eve 同源服务"
            icon={ServerCog}
            label="应用服务"
            state="ready"
          />
          <StatusRow
            description="本地密钥与持久化配置目录"
            icon={FolderKey}
            label="项目数据"
            state={readiness.dataDirectory}
          />
          <StatusRow
            description="Drizzle 迁移与应用数据连接"
            icon={Database}
            label="PostgreSQL"
            state={readiness.database}
          />
          <StatusRow
            description="管理员尚未分配可用模型"
            icon={Cable}
            label="模型连接"
            state="missing"
          />
        </div>
      </section>

      <section className={styles.modeBand} aria-label="当前运行模式">
        <div>
          <span className={styles.modeLabel}>当前模式</span>
          <strong className={styles.modeValue}>仅管理模式</strong>
        </div>
        <p className={styles.modeDescription}>
          对话入口保持关闭，不会回退到内置模型或环境变量中的提供商凭据。
        </p>
      </section>
    </ApplicationFrame>
  );
}

function StatusRow({
  description,
  icon: Icon,
  label,
  state,
}: {
  readonly description: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly state: "ready" | "missing" | "unavailable";
}) {
  return (
    <div className={styles.statusRow}>
      <span className={styles.statusIcon}>
        <Icon aria-hidden="true" size={19} />
      </span>
      <div className={styles.statusCopy}>
        <strong className={styles.statusLabel}>{label}</strong>
        <span className={styles.statusDescription}>{description}</span>
      </div>
      <StatusIndicator state={state} />
    </div>
  );
}
