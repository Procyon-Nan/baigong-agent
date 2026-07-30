"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import styles from "./login.module.css";

export function LoginForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/local-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifier: form.get("identifier"),
          password: form.get("password"),
        }),
      });
      const result = (await response.json()) as {
        user?: { mustChangePassword?: boolean };
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(result.error?.message || "登录失败。 ");
      window.location.assign(
        result.user?.mustChangePassword ? "/change-password" : "/",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败。");
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <span>用户名或邮箱</span>
        <input autoComplete="username" name="identifier" required />
      </label>
      <label>
        <span>密码</span>
        <input
          autoComplete="current-password"
          name="password"
          required
          type="password"
        />
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
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
          <ArrowRight aria-hidden="true" size={17} />
        )}
        <span>{pending ? "正在验证" : "登录"}</span>
      </button>
    </form>
  );
}
