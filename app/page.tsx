import { Cable, Database, FolderKey, ServerCog } from "lucide-react";
import { ApplicationFrame } from "@/app/components/application-frame";
import { ReloadButton } from "@/app/components/reload-button";
import { StatusIndicator } from "@/app/components/status-indicator";
import { inspectApplicationReadiness } from "@/src/server/readiness";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const readiness = await inspectApplicationReadiness();
  const checkedAt = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(readiness.checkedAt));

  return (
    <ApplicationFrame>
      <header className="topbar">
        <div>
          <span className="eyebrow">系统初始化</span>
          <h1>运行环境</h1>
        </div>
        <div className="topbar-actions">
          <span className="last-checked">检查于 {checkedAt}</span>
          <ReloadButton />
        </div>
      </header>

      <section className="status-section" aria-labelledby="service-status-title">
        <div className="section-heading">
          <div>
            <h2 id="service-status-title">服务状态</h2>
            <p>基础设施就绪后，身份认证与管理配置才能启用。</p>
          </div>
        </div>

        <div className="status-list">
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

      <section className="mode-band" aria-label="当前运行模式">
        <div>
          <span className="mode-label">当前模式</span>
          <strong>仅管理模式</strong>
        </div>
        <p>对话入口保持关闭，不会回退到内置模型或环境变量中的提供商凭据。</p>
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
  readonly icon: typeof ServerCog;
  readonly label: string;
  readonly state: "ready" | "missing" | "unavailable";
}) {
  return (
    <div className="status-row">
      <span className="status-icon">
        <Icon aria-hidden="true" size={19} />
      </span>
      <div className="status-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <StatusIndicator state={state} />
    </div>
  );
}
