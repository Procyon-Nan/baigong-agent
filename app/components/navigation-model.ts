export type NavigationMode = "setup" | "user" | "admin";
export type NavigationIcon =
  | "dashboard"
  | "chat"
  | "users"
  | "integrations"
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
    label: "系统状态",
    href: "/",
    icon: "dashboard",
    visibleIn: ["setup", "admin"],
    enabledIn: ["setup", "admin"],
  },
  {
    label: "对话",
    href: "/chat",
    icon: "chat",
    visibleIn: ["setup", "user", "admin"],
    enabledIn: ["user", "admin"],
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
