import { describe, expect, it } from "vitest";
import {
  isNavigationItemActive,
  navigationForMode,
} from "@/app/components/navigation-model";

describe("navigation model", () => {
  it("keeps setup navigation visible but disables unfinished routes", () => {
    expect(
      navigationForMode("setup").map(({ enabled, href }) => ({
        enabled,
        href,
      })),
    ).toEqual([
      { href: "/", enabled: true },
      { href: "/chat", enabled: false },
      { href: "/admin/users", enabled: false },
      { href: "/admin/integrations", enabled: false },
      { href: "/settings", enabled: false },
    ]);
  });

  it("selects role-specific destinations without treating them as authorization", () => {
    expect(navigationForMode("user").map((item) => item.href)).toEqual([
      "/chat",
      "/settings",
    ]);
    expect(navigationForMode("admin").map((item) => item.href)).toEqual([
      "/",
      "/chat",
      "/admin/users",
      "/admin/integrations",
      "/settings",
    ]);
  });

  it("matches complete route segments", () => {
    expect(isNavigationItemActive("/", "/")).toBe(true);
    expect(isNavigationItemActive("/chat/session-1", "/chat")).toBe(true);
    expect(isNavigationItemActive("/chat-history", "/chat")).toBe(false);
  });
});
