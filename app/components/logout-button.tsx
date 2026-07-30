"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { clientErrorMessage, requestJson } from "@/app/lib/api-client";
import styles from "./application-frame.module.css";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setPending(true);
    setError("");
    try {
      await requestJson<unknown>("/api/auth/logout", { method: "POST" });
      window.location.assign("/login");
    } catch (reason) {
      setError(clientErrorMessage(reason, "退出失败，请重试。"));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {error ? (
        <span className={styles.logoutError} role="alert">
          {error}
        </span>
      ) : null}
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
    </>
  );
}
