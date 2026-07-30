"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { clientErrorMessage, requestJson } from "@/app/lib/api-client";
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
      const result = await requestJson<{
        user?: { mustChangePassword?: boolean };
      }>("/api/auth/local-login", {
        method: "POST",
        body: JSON.stringify({
          identifier: form.get("identifier"),
          password: form.get("password"),
        }),
      });
      window.location.assign(
        result.user?.mustChangePassword ? "/change-password" : "/",
      );
    } catch (reason) {
      setError(clientErrorMessage(reason, "登录失败。"));
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
