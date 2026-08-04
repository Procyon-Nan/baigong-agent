"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseConversationListPage,
  type ConversationSummary,
} from "./conversation-data-protocol";
import {
  chatClientErrorMessage,
  isConversationAuthenticationError,
  readConversationData,
  requestConversation,
} from "./chat-api-client";

export function useConversationList(options: {
  readonly authorizationToken?: string;
  readonly onAuthenticationExpired: (message?: string) => void;
}) {
  const [archived, setArchived] = useState(false);
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);

  const loadPage = useCallback(
    async (input: { readonly archived: boolean; readonly cursor?: string }) => {
      const requestGeneration = ++generation.current;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          archived: input.archived ? "true" : "false",
        });
        if (input.cursor) params.set("cursor", input.cursor);
        const payload = await readConversationData(
          `/api/conversations?${params.toString()}`,
          { authorizationToken: options.authorizationToken },
        );
        const page = parseConversationListPage(payload);
        if (!page) throw new Error("服务器响应格式无效。");
        if (requestGeneration !== generation.current) return;
        setItems((current) =>
          input.cursor ? mergeConversations(current, page.items) : [...page.items],
        );
        setNextCursor(page.nextCursor);
      } catch (reason) {
        if (requestGeneration !== generation.current) return;
        if (isConversationAuthenticationError(reason)) {
          options.onAuthenticationExpired(chatClientErrorMessage(reason));
          return;
        }
        setError(chatClientErrorMessage(reason));
      } finally {
        if (requestGeneration === generation.current) setLoading(false);
      }
    },
    [options.authorizationToken, options.onAuthenticationExpired],
  );

  useEffect(() => {
    void loadPage({ archived });
  }, [archived, loadPage]);

  const mutate = useCallback(
    async (path: string, method: string, body: unknown = {}): Promise<boolean> => {
      try {
        await requestConversation(path, {
          authorizationToken: options.authorizationToken,
          method,
          body,
        });
        await loadPage({ archived });
        return true;
      } catch (reason) {
        if (isConversationAuthenticationError(reason)) {
          options.onAuthenticationExpired(chatClientErrorMessage(reason));
          return false;
        }
        setError(chatClientErrorMessage(reason));
        return false;
      }
    },
    [
      archived,
      loadPage,
      options.authorizationToken,
      options.onAuthenticationExpired,
    ],
  );

  const archive = useCallback(
    (conversationId: string) =>
      mutate(`/api/conversations/${conversationId}/archive`, "POST"),
    [mutate],
  );
  const loadMore = useCallback(
    () =>
      nextCursor
        ? loadPage({ archived, cursor: nextCursor })
        : Promise.resolve(),
    [archived, loadPage, nextCursor],
  );
  const refresh = useCallback(
    () => loadPage({ archived }),
    [archived, loadPage],
  );
  const rename = useCallback(
    (conversationId: string, title: string) =>
      mutate(`/api/conversations/${conversationId}`, "PATCH", { title }),
    [mutate],
  );
  const restore = useCallback(
    (conversationId: string) =>
      mutate(`/api/conversations/${conversationId}/restore`, "POST"),
    [mutate],
  );

  return {
    archived,
    archive,
    error,
    hasMore: nextCursor !== null,
    items,
    loading,
    loadMore,
    refresh,
    rename,
    restore,
    setArchived,
  } as const;
}

function mergeConversations(
  current: readonly ConversationSummary[],
  incoming: readonly ConversationSummary[],
): ConversationSummary[] {
  const byId = new Map(current.map((conversation) => [conversation.id, conversation]));
  for (const conversation of incoming) byId.set(conversation.id, conversation);
  return [...byId.values()];
}
