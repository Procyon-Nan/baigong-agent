import { ArrowLeft, FileQuestion } from "lucide-react";
import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="centered-state">
      <FileQuestion aria-hidden="true" size={28} />
      <h1>页面不存在</h1>
      <p>请求的地址无效或已被移除。</p>
      <Link className="command-button" href="/">
        <ArrowLeft aria-hidden="true" size={16} />
        返回系统状态
      </Link>
    </main>
  );
}
