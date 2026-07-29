"use client";

import styles from "./error-state.module.css";

export default function GlobalError({ reset }: { readonly reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body>
        <main className={styles.globalError}>
          <h1 className={styles.title}>应用无法加载</h1>
          <p className={styles.copy}>服务遇到未处理的错误。</p>
          <button className={styles.commandButton} onClick={reset} type="button">
            重新加载
          </button>
        </main>
      </body>
    </html>
  );
}
