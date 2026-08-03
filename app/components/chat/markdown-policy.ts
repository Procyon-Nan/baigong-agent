const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeMarkdownUrl(value: string): string {
  try {
    const url = new URL(value);
    return ALLOWED_LINK_PROTOCOLS.has(url.protocol) ? value : "";
  } catch {
    return "";
  }
}
