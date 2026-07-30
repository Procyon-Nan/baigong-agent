"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
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
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        currentPassword: form.get("currentPassword"),
        newPassword,
      }),
    });
    const result = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) {
      setMessage({
        kind: "error",
        text: result.error?.message || "密码修改失败。",
      });
      setPending(false);
      return;
    }
    setMessage({ kind: "success", text: "密码已更新，正在返回工作台。" });
    window.setTimeout(() => window.location.assign("/"), 500);
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
