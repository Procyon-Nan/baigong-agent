"use client";

import { Check, Copy, ImageOff } from "lucide-react";
import {
  isValidElement,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeMarkdownUrl } from "./markdown-policy";
import styles from "./markdown.module.css";

const components: Components = {
  a({ href, children }) {
    const safeHref = href ? safeMarkdownUrl(href) : "";
    return safeHref ? (
      <a href={safeHref} rel="noopener noreferrer" target="_blank">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  img({ alt }) {
    return (
      <span className={styles.blockedImage}>
        <ImageOff aria-hidden="true" size={14} />
        {alt || "图片"}
      </span>
    );
  },
  pre({ children }) {
    return <MarkdownCodeBlock>{children}</MarkdownCodeBlock>;
  },
};

export function MarkdownContent({ markdown }: { readonly markdown: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeMarkdownUrl}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownCodeBlock({ children }: { readonly children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = isValidElement<ComponentProps<"code">>(children)
    ? children
    : null;
  const code = child ? textContent(child.props.children).replace(/\n$/, "") : "";
  const language = child?.props.className?.match(/language-([^\s]+)/)?.[1];

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  if (!child) return <pre>{children}</pre>;

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{language ?? "text"}</span>
        <button
          aria-label="复制代码"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          title="复制代码"
          type="button"
        >
          {copied ? (
            <Check aria-hidden="true" size={14} />
          ) : (
            <Copy aria-hidden="true" size={14} />
          )}
        </button>
      </div>
      <pre>
        <code className={child.props.className}>{code}</code>
      </pre>
    </div>
  );
}

function textContent(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(textContent).join("");
  return "";
}
