import { Bot, LayoutDashboard, LockKeyhole, Settings, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./application-frame.module.css";

const navigation = [
  { label: "系统状态", icon: LayoutDashboard, active: true },
  { label: "对话", icon: Bot, active: false },
  { label: "用户", icon: UsersRound, active: false },
  { label: "设置", icon: Settings, active: false },
] as const;

export function ApplicationFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.applicationFrame}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>百</span>
          <span>
            <strong className={styles.brandName}>百工 Agent</strong>
            <small className={styles.brandDescription}>管理工作台</small>
          </span>
        </div>

        <nav aria-label="主导航" className={styles.navigation}>
          {navigation.map(({ active, icon: Icon, label }) => (
            <div
              aria-current={active ? "page" : undefined}
              className={`${styles.navigationItem} ${active ? styles.active : styles.disabled}`}
              key={label}
            >
              <Icon aria-hidden="true" size={17} />
              <span>{label}</span>
              {!active ? (
                <LockKeyhole aria-hidden="true" className={styles.navigationLock} size={13} />
              ) : null}
            </div>
          ))}
        </nav>

        <div className={styles.sidebarFoot}>
          <span className={styles.environmentDot} />
          <span>P1 基础环境</span>
        </div>
      </aside>
      <main className={styles.mainContent}>{children}</main>
    </div>
  );
}
