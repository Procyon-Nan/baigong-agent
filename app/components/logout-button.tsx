"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import styles from "./application-frame.module.css";

export function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <button
      aria-label="退出登录"
      className={styles.logoutButton}
      disabled={pending}
      onClick={logout}
      title="退出登录"
      type="button"
    >
      <LogOut aria-hidden="true" size={15} />
    </button>
  );
}
