import type { ReactNode } from "react";
import { Navigation } from "./navigation";
import { LogoutButton } from "./logout-button";
import type { NavigationMode } from "./navigation-model";
import styles from "./application-frame.module.css";

export function ApplicationFrame({
  children,
  contentWidth = "default",
  navigationMode = "setup",
  user,
}: {
  readonly children: ReactNode;
  readonly contentWidth?: "default" | "wide";
  readonly navigationMode?: NavigationMode;
  readonly user?: {
    readonly displayName: string;
    readonly role: "USER" | "ADMIN";
  };
}) {
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

        <Navigation mode={navigationMode} />

        <div className={styles.sidebarFoot}>
          <span className={styles.environmentDot} />
          <span className={styles.sidebarIdentity}>
            {user ? `${user.displayName} · ${user.role}` : "P2 身份与权限"}
          </span>
          {user ? <LogoutButton /> : null}
        </div>
      </aside>
      <main
        className={`${styles.mainContent} ${
          contentWidth === "wide" ? styles.wideContent : ""
        }`}
      >
        {children}
      </main>
    </div>
  );
}
