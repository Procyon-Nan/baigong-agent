import { ArrowLeft, FileQuestion } from "lucide-react";
import Link from "next/link";
import styles from "./error-state.module.css";

export default function NotFoundPage() {
  return (
    <main className={styles.centeredState}>
      <FileQuestion aria-hidden="true" className={styles.icon} size={28} />
      <h1 className={styles.title}>页面不存在</h1>
      <p className={styles.copy}>请求的地址无效或已被移除。</p>
      <Link className={styles.commandButton} href="/">
        <ArrowLeft aria-hidden="true" size={16} />
        返回系统状态
      </Link>
    </main>
  );
}
