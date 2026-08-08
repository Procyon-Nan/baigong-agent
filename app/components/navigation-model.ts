export type NavigationMode = "setup" | "user" | "admin";
export type NavigationIcon =
  | "chat"
  | "models"
  | "capabilities"
  | "users"
  | "integrations"
  | "conversations"
  | "settings";

export type NavigationItem = {
  readonly label: string;
  readonly href: string;
  readonly icon: NavigationIcon;
  readonly visibleIn: readonly NavigationMode[];
  readonly enabledIn: readonly NavigationMode[];
};

const navigationItems: readonly NavigationItem[] = [
  {
    label: "对话",
    href: "/",
    icon: "chat",
    visibleIn: ["setup", "user", "admin"],
    enabledIn: ["user", "admin"],
  },
  {
    label: "模型配置",
    href: "/admin/models",
    icon: "models",
    visibleIn: ["setup", "admin"],
    enabledIn: ["admin"],
  },
  {
    label: "Agent 能力",
    href: "/admin/agent-capabilities",
    icon: "capabilities",
    visibleIn: ["setup", "admin"],
    enabledIn: ["admin"],
  },
  {
    label: "用户",
    href: "/admin/users",
    icon: "users",
    visibleIn: ["setup", "admin"],
    enabledIn: ["admin"],
  },
  {
    label: "嵌入接入",
    href: "/admin/integrations",
    icon: "integrations",
    visibleIn: ["setup", "admin"],
    enabledIn: ["admin"],
  },
  {
    label: "会话审计",
    href: "/admin/conversations",
    icon: "conversations",
    visibleIn: ["setup", "admin"],
    enabledIn: ["admin"],
  },
  {
    label: "设置",
    href: "/settings",
    icon: "settings",
    visibleIn: ["setup", "user", "admin"],
    enabledIn: ["user", "admin"],
  },
] as const;

export type NavigationItemState = NavigationItem & {
  readonly enabled: boolean;
};

export function navigationForMode(
  mode: NavigationMode,
): readonly NavigationItemState[] {
  return navigationItems
    .filter((item) => item.visibleIn.includes(mode))
    .map((item) => ({ ...item, enabled: item.enabledIn.includes(mode) }));
}

export function isNavigationItemActive(
  pathname: string,
  href: string,
): boolean {
  return href === "/"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}
