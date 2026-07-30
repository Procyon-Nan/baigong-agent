"use client";

import {
  Bot,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Settings,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  isNavigationItemActive,
  navigationForMode,
  type NavigationIcon,
  type NavigationMode,
} from "./navigation-model";
import styles from "./application-frame.module.css";

const navigationIcons = {
  dashboard: LayoutDashboard,
  chat: Bot,
  users: UsersRound,
  integrations: KeyRound,
  settings: Settings,
} satisfies Record<NavigationIcon, typeof LayoutDashboard>;

export function Navigation({ mode }: { readonly mode: NavigationMode }) {
  const pathname = usePathname();

  return (
    <nav aria-label="主导航" className={styles.navigation}>
      {navigationForMode(mode).map((item) => {
        const Icon = navigationIcons[item.icon];
        const active =
          item.enabled && isNavigationItemActive(pathname, item.href);
        const className = `${styles.navigationItem} ${
          active ? styles.active : item.enabled ? "" : styles.disabled
        }`;
        const content = (
          <>
            <Icon aria-hidden="true" size={17} />
            <span>{item.label}</span>
            {!item.enabled ? (
              <LockKeyhole
                aria-hidden="true"
                className={styles.navigationLock}
                size={13}
              />
            ) : null}
          </>
        );

        return item.enabled ? (
          <Link
            aria-current={active ? "page" : undefined}
            className={className}
            href={item.href}
            key={item.href}
          >
            {content}
          </Link>
        ) : (
          <span aria-disabled="true" className={className} key={item.href}>
            {content}
          </span>
        );
      })}
    </nav>
  );
}
