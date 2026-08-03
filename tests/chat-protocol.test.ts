import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isConversationAuthenticationError,
  readConversationEventStream,
  requestConversation,
} from "@/app/components/chat/chat-api-client";
import {
  applyAssistantDelta,
  completeAssistantMessage,
  discardIncompleteAssistantMessage,
} from "@/app/components/chat/message-state";
import { MarkdownContent } from "@/app/components/chat/markdown-content";
import { safeMarkdownUrl } from "@/app/components/chat/markdown-policy";
import {
  parseConversationMutationResult,
  parsePublicConversationEvent,
  splitNdjson,
} from "@/app/components/chat/protocol";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat protocol", () => {
  it("accepts only the public conversation response shape", () => {
    expect(
      parseConversationMutationResult({
        conversation: { id: "conversation-1", status: "RUNNING" },
        turn: { id: "turn-1", status: "RUNNING" },
        duplicate: false,
      }),
    ).toEqual({
      conversationId: "conversation-1",
      turnId: "turn-1",
      status: "RUNNING",
    });
    expect(
      parseConversationMutationResult({
        conversation: {
          id: "conversation-1",
          status: "INTERNAL_STATE",
        },
        turn: { id: "turn-1", status: "RUNNING" },
      }),
    ).toBeNull();
  });

  it("reconstructs NDJSON records split across transport chunks", () => {
    const first = splitNdjson("", '{"type":"heartbeat"');
    expect(first.lines).toEqual([]);
    const second = splitNdjson(first.remainder, '}\n{"type":"next"}\npartial');
    expect(second.lines).toEqual([
      '{"type":"heartbeat"}',
      '{"type":"next"}',
    ]);
    expect(second.remainder).toBe("partial");
  });

  it("drops unknown events and fields not matching the allowlist", () => {
    expect(
      parsePublicConversationEvent({
        type: "reasoning.delta",
        conversationId: "conversation-1",
        cursor: 1,
        at: "2026-07-30T00:00:00.000Z",
        data: { text: "private" },
      }),
    ).toBeNull();
    expect(
      parsePublicConversationEvent({
        type: "assistant.delta",
        conversationId: "conversation-1",
        cursor: 2,
        at: "2026-07-30T00:00:00.000Z",
        data: {
          turnId: "turn-1",
          blockId: "block-1",
          delta: "你",
          text: "你",
          providerResponse: "must-not-pass",
        },
      }),
    ).toEqual({
      type: "assistant.delta",
      conversationId: "conversation-1",
      cursor: 2,
      at: "2026-07-30T00:00:00.000Z",
      data: {
        turnId: "turn-1",
        blockId: "block-1",
        delta: "你",
        text: "你",
      },
    });
  });

  it("accepts the pre-event cursor used by initial heartbeats", () => {
    expect(
      parsePublicConversationEvent({
        type: "heartbeat",
        conversationId: "conversation-1",
        cursor: -1,
        at: "2026-07-30T00:00:00.000Z",
        data: {},
      }),
    ).toMatchObject({ type: "heartbeat", cursor: -1 });
  });
});

describe("chat API client", () => {
  it("adds the in-memory embed token only to the active request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer embed-token",
      );
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await requestConversation("/api/conversations", {
      authorizationToken: "embed-token",
      method: "POST",
      body: { message: "hello", requestId: "request-1" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails an unauthorized event stream without reconnecting", async () => {
    const authenticationExpired = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(null, { status: 401 })),
    );

    await expect(
      readConversationEventStream({
        authorizationToken: "expired-token",
        conversationId: "conversation-1",
        cursor: 3,
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        onAuthenticationExpired: authenticationExpired,
      }),
    ).resolves.toBe(false);
    expect(authenticationExpired).toHaveBeenCalledOnce();
  });

  it("classifies unauthorized embedded mutations as authentication expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(null, { status: 401 })),
    );

    const failure = await requestConversation("/api/conversations", {
      authorizationToken: "expired-token",
      method: "POST",
      body: { message: "hello", requestId: "request-1" },
    }).catch((error: unknown) => error);

    expect(isConversationAuthenticationError(failure)).toBe(true);
  });
});

describe("chat message state", () => {
  const draft = {
    id: "block-1",
    role: "assistant" as const,
    text: "旧文本",
    complete: false,
  };

  it("uses the authoritative snapshot when a retry rewrites partial output", () => {
    expect(
      applyAssistantDelta([draft], {
        id: draft.id,
        delta: "不会直接追加",
        snapshot: "重试后的文本",
      }),
    ).toEqual([{ ...draft, text: "重试后的文本" }]);
  });

  it("never lets a later delta reopen or discard a completed reply", () => {
    const completed = completeAssistantMessage([draft], draft.id, "最终文本");
    expect(
      applyAssistantDelta(completed, {
        id: draft.id,
        delta: "迟到增量",
        snapshot: "错误快照",
      }),
    ).toEqual(completed);
    expect(discardIncompleteAssistantMessage(completed, draft.id)).toEqual(
      completed,
    );
  });
});

describe("Markdown URL policy", () => {
  it.each([
    "https://example.com/reference",
    "http://localhost:3000/path",
    "mailto:operator@example.com",
  ])("allows an explicit safe protocol: %s", (url) => {
    expect(safeMarkdownUrl(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html;base64,abc",
    "file:///etc/passwd",
    "/relative/path",
    "custom:resource",
  ])("blocks a disallowed Markdown URL: %s", (url) => {
    expect(safeMarkdownUrl(url)).toBe("");
  });

  it("does not render raw HTML, remote images, or unsafe link targets", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        markdown:
          '<script>alert("html")</script>\n\n![remote](https://example.com/image.png)\n\n[unsafe](javascript:alert(1))',
      }),
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('src="https://example.com/image.png"');
  });

  it("renders inline and display LaTeX through KaTeX", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        markdown: "Inline $E = mc^2$ and display:\n\n$$\n\\frac{a}{b}\n$$",
      }),
    );

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain("math");
  });

  it("highlights completed fenced code and leaves streaming code plain", () => {
    const markdown = "```python\ndef greet(name):\n    return name\n```";
    const completed = renderToStaticMarkup(
      createElement(MarkdownContent, { markdown, complete: true }),
    );
    const streaming = renderToStaticMarkup(
      createElement(MarkdownContent, { markdown, complete: false }),
    );

    expect(completed).toContain("language-python");
    expect(completed).toContain("token keyword");
    expect(streaming).toContain("language-python");
    expect(streaming).not.toContain("token keyword");
  });
});
