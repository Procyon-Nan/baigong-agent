import type { Metadata } from "next";
import { EmbedRuntime } from "./runtime";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "嵌入会话" };

export default function EmbedPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brandMark}>百</span>
        <strong>百工 Agent</strong>
      </header>
      <EmbedRuntime />
    </main>
  );
}
