"use client";

import { Check, Copy, ImageOff } from "lucide-react";
import {
  isValidElement,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Highlight, themes } from "prism-react-renderer";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { safeMarkdownUrl } from "./markdown-policy";
import styles from "./markdown.module.css";

const contentComponents: Components = {
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
};

export function MarkdownContent({
  complete = true,
  markdown,
}: {
  readonly complete?: boolean;
  readonly markdown: string;
}) {
  const components: Components = {
    ...contentComponents,
    pre({ children }) {
      return (
        <MarkdownCodeBlock complete={complete}>{children}</MarkdownCodeBlock>
      );
    },
  };

  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        components={components}
        rehypePlugins={[[rehypeKatex, { trust: false }]]}
        remarkPlugins={[remarkGfm, remarkMath]}
        skipHtml
        urlTransform={safeMarkdownUrl}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownCodeBlock({
  children,
  complete,
}: {
  readonly children: ReactNode;
  readonly complete: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const child = isValidElement<ComponentProps<"code">>(children)
    ? children
    : null;
  const code = child ? textContent(child.props.children).replace(/\n$/, "") : "";
  const language = codeLanguage(child?.props.className);

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
      {complete && language ? (
        <HighlightedCode code={code} language={language} />
      ) : (
        <pre>
          <code className={child.props.className}>{code}</code>
        </pre>
      )}
    </div>
  );
}

function HighlightedCode({
  code,
  language,
}: {
  readonly code: string;
  readonly language: string;
}) {
  return (
    <Highlight code={code} language={language} theme={themes.vsDark}>
      {({ className, getLineProps, getTokenProps, style, tokens }) => (
        <pre
          className={className}
          style={{ ...style, backgroundColor: "transparent" }}
        >
          <code className={`language-${language}`}>
            {tokens.map((line, lineIndex) => (
              <span key={lineIndex} {...getLineProps({ line })}>
                {line.map((token, tokenIndex) => (
                  <span key={tokenIndex} {...getTokenProps({ token })} />
                ))}
                {lineIndex < tokens.length - 1 ? "\n" : null}
              </span>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  );
}

function codeLanguage(className: string | undefined): string | null {
  const value = className?.match(/(?:^|\s)language-([^\s]+)/)?.[1];
  if (!value || !/^[a-z0-9_+#.-]{1,64}$/i.test(value)) return null;
  return value.toLowerCase();
}

function textContent(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(textContent).join("");
  return "";
}
