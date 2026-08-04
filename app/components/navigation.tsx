"use client";

import {
  Bot,
  Boxes,
  KeyRound,
  LockKeyhole,
  MessageSquareText,
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
  chat: Bot,
  models: Boxes,
  users: UsersRound,
  integrations: KeyRound,
  conversations: MessageSquareText,
  settings: Settings,
} satisfies Record<NavigationIcon, typeof Bot>;

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
