"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import styles from "./error-state.module.css";

export default function ErrorPage({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error("Application route failed", error);
  }, [error]);

  return (
    <main className={styles.centeredState}>
      <AlertTriangle aria-hidden="true" className={styles.icon} size={28} />
      <h1 className={styles.title}>页面暂时不可用</h1>
      <p className={styles.copy}>请求未能完成，请稍后重试。</p>
      <button className={styles.commandButton} onClick={reset} type="button">
        <RotateCcw aria-hidden="true" size={16} />
        重试
      </button>
    </main>
  );
}
