import { projectTodoItems } from "@/src/server/conversations/ui-state-projection";
import type {
  EveEventProjectionContext,
  PublicConversationEvent,
} from "./projection-types";

export function projectTodoUpdated(
  event: Record<string, unknown>,
  context: EveEventProjectionContext,
  at: string,
): PublicConversationEvent | null {
  const items = projectTodoItems(event);
  return items
    ? {
        type: "todo.updated",
        conversationId: context.conversationId,
        cursor: context.cursor,
        at,
        data: { items },
      }
    : null;
}
