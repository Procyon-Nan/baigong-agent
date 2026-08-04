"use client";

import { useEffect, useState } from "react";
import {
  parseConversationNodePage,
  type ConversationNode,
} from "./conversation-data-protocol";
import {
  chatClientErrorMessage,
  isConversationAuthenticationError,
  readConversationData,
} from "./chat-api-client";

export function useConversationNodes(options: {
  readonly authorizationToken?: string;
  readonly conversationId: string | null;
  readonly refreshKey: number;
  readonly onAuthenticationExpired: (message?: string) => void;
}) {
  const [nodes, setNodes] = useState<ConversationNode[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    if (!options.conversationId) {
      setNodes([]);
      setError("");
      return () => controller.abort();
    }
    setNodes([]);
    setError("");
    void readAllNodes(
      options.conversationId,
      options.authorizationToken,
      controller.signal,
    )
      .then((items) => {
        if (!controller.signal.aborted) setNodes(items);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (isConversationAuthenticationError(reason)) {
          options.onAuthenticationExpired(chatClientErrorMessage(reason));
          return;
        }
        setError(chatClientErrorMessage(reason));
      });
    return () => controller.abort();
  }, [
    options.authorizationToken,
    options.conversationId,
    options.onAuthenticationExpired,
    options.refreshKey,
  ]);

  return { error, nodes } as const;
}

async function readAllNodes(
  conversationId: string,
  authorizationToken: string | undefined,
  signal: AbortSignal,
): Promise<ConversationNode[]> {
  const nodes: ConversationNode[] = [];
  let cursor: string | null = null;
  do {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const payload = await readConversationData(
      `/api/conversations/${conversationId}/nodes${query}`,
      { authorizationToken, signal },
    );
    const page = parseConversationNodePage(payload);
    if (!page) throw new Error("服务器响应格式无效。");
    nodes.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && !signal.aborted);
  return nodes;
}
