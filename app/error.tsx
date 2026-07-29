"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

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
    <main className="centered-state">
      <AlertTriangle aria-hidden="true" size={28} />
      <h1>页面暂时不可用</h1>
      <p>请求未能完成，请稍后重试。</p>
      <button className="command-button" onClick={reset} type="button">
        <RotateCcw aria-hidden="true" size={16} />
        重试
      </button>
    </main>
  );
}
