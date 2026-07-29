"use client";

export default function GlobalError({ reset }: { readonly reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body>
        <main className="global-error">
          <h1>应用无法加载</h1>
          <p>服务遇到未处理的错误。</p>
          <button onClick={reset} type="button">
            重新加载
          </button>
        </main>
      </body>
    </html>
  );
}
