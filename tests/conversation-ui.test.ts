import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  parseConversationHistoryPage,
  parseConversationListPage,
  parseConversationNodePage,
  parseConversationSnapshot,
  type ConversationHistoryMessage,
  type ConversationSubagent,
  type ConversationSummary,
} from "@/app/components/chat/conversation-data-protocol";
import { ConversationHistory } from "@/app/components/chat/conversation-history";
import { ConversationInteractions } from "@/app/components/chat/conversation-interactions";
import { ConversationSidebar } from "@/app/components/chat/conversation-sidebar";
import { fromConversationHistoryMessage } from "@/app/components/chat/conversation-message-adapter";
import { parsePublicConversationEvent } from "@/app/components/chat/protocol";
import { SubagentCard } from "@/app/components/chat/subagent-card";

const timestamp = "2026-08-04T08:00:00.000Z";

const conversation: ConversationSummary = {
  id: "conversation-1",
  title: "检查知识库",
  status: "WAITING",
  activeTurn: null,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const historyMessage: ConversationHistoryMessage = {
  id: "message-1",
  turnId: "turn-1",
  sequence: 1,
  role: "USER",
  status: "COMPLETED",
  body: "用户问题",
  attachments: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("conversation data protocol", () => {
  it("accepts the list, snapshot, history and node response contracts", () => {
    expect(
      parseConversationListPage({ items: [conversation], nextCursor: null }),
    ).toEqual({ items: [conversation], nextCursor: null });
    expect(
      parseConversationHistoryPage({
        items: [historyMessage],
        nextCursor: "older",
      }),
    ).toMatchObject({ items: [historyMessage], nextCursor: "older" });
    expect(
      parseConversationNodePage({
        items: [
          {
            id: "message-1",
            turnId: "turn-1",
            sequence: 1,
            summary: "用户问题",
            createdAt: timestamp,
          },
        ],
        nextCursor: null,
      }),
    ).toMatchObject({ items: [{ id: "message-1" }] });
    expect(
      parseConversationSnapshot({
        conversation,
        context: {
          kind: "MAIN",
          parentConversationId: null,
          subagentName: null,
          linkStatus: "NOT_APPLICABLE",
        },
        messages: { items: [historyMessage], nextCursor: null },
        lastEveCursor: 12,
        subagents: [verifiedSubagent()],
        uiState: { todos: [], pendingInput: null },
      }),
    ).toMatchObject({
      conversation: { id: "conversation-1" },
      context: { kind: "MAIN" },
      lastEveCursor: 12,
      subagents: [{ conversationId: "subagent-1" }],
    });
  });

  it("rejects malformed response fields", () => {
    expect(
      parseConversationListPage({
        items: [{ ...conversation, updatedAt: "not-a-timestamp" }],
        nextCursor: null,
      }),
    ).toBeNull();
    expect(
      parseConversationSnapshot({
        conversation,
        context: { kind: "UNKNOWN" },
        messages: { items: [], nextCursor: null },
        lastEveCursor: null,
        subagents: [],
      }),
    ).toBeNull();
  });

  it("parses only the public subagent event fields", () => {
    expect(
      parsePublicConversationEvent({
        type: "subagent.created",
        conversationId: "conversation-1",
        cursor: 13,
        at: timestamp,
        data: {
          childConversationId: "subagent-1",
          name: "researcher",
          linkStatus: "VERIFIED",
          status: "RUNNING",
          continuationToken: "must-not-pass",
        },
      }),
    ).toEqual({
      type: "subagent.created",
      conversationId: "conversation-1",
      cursor: 13,
      at: timestamp,
      data: {
        childConversationId: "subagent-1",
        name: "researcher",
        linkStatus: "VERIFIED",
        status: "RUNNING",
      },
    });
  });
});

describe("conversation presentation", () => {
  it.each([
    ["USER", "user"],
    ["ASSISTANT", "assistant"],
    ["DELEGATION", "delegation"],
  ] as const)("maps %s history into the %s message role", (role, expected) => {
    expect(
      fromConversationHistoryMessage({ ...historyMessage, role }).role,
    ).toBe(expected);
  });

  it("renders the conversation sidebar structure", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationSidebar, {
        archived: false,
        hasMore: false,
        items: [conversation],
        loading: false,
        onArchive: async () => true,
        onClose: vi.fn(),
        onLoadMore: async () => undefined,
        onNewConversation: vi.fn(),
        onRename: async () => true,
        onRestore: async () => true,
        onSelect: vi.fn(),
        onViewChange: vi.fn(),
        open: true,
        selectedConversationId: conversation.id,
      }),
    );

    expect(html).toContain('aria-label="会话列表"');
    expect(html).toContain("检查知识库");
    expect(html).toContain('aria-selected="true"');
  });

  it("allows entry only after a subagent relationship is verified", () => {
    const verified = renderToStaticMarkup(
      createElement(SubagentCard, {
        onOpen: vi.fn(),
        subagent: verifiedSubagent(),
      }),
    );
    const pending = renderToStaticMarkup(
      createElement(SubagentCard, {
        onOpen: vi.fn(),
        subagent: { ...verifiedSubagent(), linkStatus: "PENDING" },
      }),
    );

    expect(verified).not.toContain("disabled");
    expect(pending).toContain("disabled");
    expect(pending).toContain("正在验证会话关系");
  });

  it("renders delegation history and a subagent timeline card", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationHistory, {
        conversationId: conversation.id,
        hasMoreHistory: false,
        loadingEarlier: false,
        messages: [
          fromConversationHistoryMessage({
            ...historyMessage,
            role: "DELEGATION",
            body: "查询发票规则",
          }),
        ],
        onLoadEarlier: async () => undefined,
        onOpenSubagent: vi.fn(),
        onVisibleUserMessageChange: vi.fn(),
        scrollRequest: null,
        subagents: [verifiedSubagent()],
      }),
    );

    expect(html).toContain("主 Agent 委派");
    expect(html).toContain("查询发票规则");
    expect(html).toContain("researcher");
  });

  it("renders todo progress and interactive question choices", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationInteractions, {
        canRespond: true,
        onAnswer: async () => true,
        pendingInput: {
          origin: "MAIN",
          requests: [
            {
              requestId: "request-1",
              prompt: "请选择核查范围",
              display: "select",
              allowFreeform: true,
              options: [
                {
                  id: "all",
                  label: "全部资料",
                  description: "检查全部知识源",
                  style: "primary",
                },
              ],
            },
          ],
        },
        todos: [
          {
            content: "读取知识库",
            priority: "high",
            status: "in_progress",
          },
        ],
      }),
    );

    expect(html).toContain("任务进度");
    expect(html).toContain("读取知识库");
    expect(html).toContain("请选择核查范围");
    expect(html).toContain("全部资料");
    expect(html).toContain("自由回答");
  });
});

function verifiedSubagent(): ConversationSubagent {
  return {
    conversationId: "subagent-1",
    name: "researcher",
    linkStatus: "VERIFIED",
    status: "RUNNING",
    createdAt: timestamp,
  };
}
