import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "登录" };

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.brand}>
          <span className={styles.brandMark}>百</span>
          <span>
            <strong>百工 Agent</strong>
            <small>身份验证</small>
          </span>
        </div>
        <header className={styles.header}>
          <h1 id="login-title">登录</h1>
          <p>使用本项目的本地账号进入工作台。</p>
        </header>
        <LoginForm />
      </section>
    </main>
  );
}
