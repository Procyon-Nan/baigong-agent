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
      { href: "/", enabled: false },
      { href: "/admin/models", enabled: false },
      { href: "/admin/agent-capabilities", enabled: false },
      { href: "/admin/users", enabled: false },
      { href: "/admin/integrations", enabled: false },
      { href: "/admin/conversations", enabled: false },
      { href: "/settings", enabled: false },
    ]);
  });

  it("selects role-specific destinations without treating them as authorization", () => {
    expect(navigationForMode("user").map((item) => item.href)).toEqual([
      "/",
      "/settings",
    ]);
    expect(navigationForMode("admin").map((item) => item.href)).toEqual([
      "/",
      "/admin/models",
      "/admin/agent-capabilities",
      "/admin/users",
      "/admin/integrations",
      "/admin/conversations",
      "/settings",
    ]);
  });

  it("matches complete route segments", () => {
    expect(isNavigationItemActive("/", "/")).toBe(true);
    expect(isNavigationItemActive("/admin/models", "/admin/models")).toBe(
      true,
    );
    expect(isNavigationItemActive("/admin/model-settings", "/admin/models")).toBe(
      false,
    );
  });
});
