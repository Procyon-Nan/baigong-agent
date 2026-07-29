import { Bot, LayoutDashboard, LockKeyhole, Settings, UsersRound } from "lucide-react";
import type { ReactNode } from "react";

const navigation = [
  { label: "系统状态", icon: LayoutDashboard, active: true },
  { label: "对话", icon: Bot, active: false },
  { label: "用户", icon: UsersRound, active: false },
  { label: "设置", icon: Settings, active: false },
] as const;

export function ApplicationFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="application-frame">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">百</span>
          <span>
            <strong>百工 Agent</strong>
            <small>管理工作台</small>
          </span>
        </div>

        <nav aria-label="主导航" className="navigation">
          {navigation.map(({ active, icon: Icon, label }) => (
            <div
              aria-current={active ? "page" : undefined}
              className={active ? "navigation-item active" : "navigation-item disabled"}
              key={label}
            >
              <Icon aria-hidden="true" size={17} />
              <span>{label}</span>
              {!active ? <LockKeyhole aria-hidden="true" className="nav-lock" size={13} /> : null}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="environment-dot" />
          <span>P1 基础环境</span>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
