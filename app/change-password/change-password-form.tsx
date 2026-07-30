"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { clientErrorMessage, requestJson } from "@/app/lib/api-client";
import styles from "./page.module.css";

export function ChangePasswordForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") || "");
    if (newPassword !== form.get("confirmPassword")) {
      setMessage({ kind: "error", text: "两次输入的新密码不一致。" });
      setPending(false);
      return;
    }
    try {
      await requestJson<{ success: true }>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          newPassword,
        }),
      });
      setMessage({ kind: "success", text: "密码已更新，正在返回工作台。" });
      window.setTimeout(() => window.location.assign("/"), 500);
    } catch (reason) {
      setMessage({
        kind: "error",
        text: clientErrorMessage(reason, "密码修改失败。"),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <span>当前密码</span>
        <input
          autoComplete="current-password"
          name="currentPassword"
          required
          type="password"
        />
      </label>
      <label>
        <span>新密码</span>
        <input
          autoComplete="new-password"
          minLength={12}
          name="newPassword"
          required
          type="password"
        />
      </label>
      <label>
        <span>确认新密码</span>
        <input
          autoComplete="new-password"
          minLength={12}
          name="confirmPassword"
          required
          type="password"
        />
      </label>
      {message ? (
        <p
          className={message.kind === "error" ? styles.error : styles.success}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
      <button disabled={pending} type="submit">
        {pending ? (
          <LoaderCircle
            aria-hidden="true"
            className={styles.spinner}
            size={17}
          />
        ) : (
          <KeyRound aria-hidden="true" size={17} />
        )}
        <span>{pending ? "正在更新" : "更新密码"}</span>
      </button>
    </form>
  );
}
