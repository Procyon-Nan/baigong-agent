import { isInputRequest, type HandleMessageStreamEvent } from "eve/client";
import type {
  PublicInputRequest,
  PublicTodoItem,
} from "@/src/shared/conversation-ui-state";

const MAX_INPUT_REQUESTS = 20;
const MAX_INPUT_OPTIONS = 20;
const MAX_INPUT_PROMPT_CHARACTERS = 4_000;
const MAX_INPUT_LABEL_CHARACTERS = 500;
const MAX_INPUT_DESCRIPTION_CHARACTERS = 1_000;
const MAX_INPUT_ID_CHARACTERS = 512;
const MAX_TODO_ITEMS = 100;
const MAX_TODO_CONTENT_CHARACTERS = 2_000;

type ActionResultEvent = Extract<
  HandleMessageStreamEvent,
  { type: "action.result" }
>;

export function projectInputRequests(
  event: unknown,
): readonly PublicInputRequest[] | null {
  if (!isRecord(event) || !isRecord(event.data)) return null;
  const rawRequests = event.data.requests;
  if (
    !Array.isArray(rawRequests) ||
    rawRequests.length === 0 ||
    rawRequests.length > MAX_INPUT_REQUESTS
  ) {
    return null;
  }

  const requests: PublicInputRequest[] = [];
  for (const request of rawRequests) {
    if (
      !isInputRequest(request) ||
      !fits(request.requestId, MAX_INPUT_ID_CHARACTERS) ||
      !fits(request.prompt, MAX_INPUT_PROMPT_CHARACTERS) ||
      (request.options?.length ?? 0) > MAX_INPUT_OPTIONS ||
      request.options?.some(
        (option) =>
          !fits(option.id, MAX_INPUT_ID_CHARACTERS) ||
          !fits(option.label, MAX_INPUT_LABEL_CHARACTERS) ||
          (option.description !== undefined &&
            !withinLimit(
              option.description,
              MAX_INPUT_DESCRIPTION_CHARACTERS,
            )),
      )
    ) {
      return null;
    }
    requests.push({
      requestId: request.requestId,
      prompt: request.prompt,
      display: request.display ?? null,
      allowFreeform: request.allowFreeform ?? false,
      options:
        request.options?.map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description ?? null,
          style: option.style ?? null,
        })) ?? [],
    });
  }
  return requests;
}

export function projectTodoItems(
  event: ActionResultEvent | Record<string, unknown>,
): readonly PublicTodoItem[] | null {
  if (!isRecord(event.data)) return null;
  const data = event.data;
  if (data.status !== "completed" || !isRecord(data.result)) return null;
  const result = data.result;
  if (
    result.kind !== "tool-result" ||
    result.toolName !== "todo" ||
    result.isError === true ||
    !isRecord(result.output) ||
    !Array.isArray(result.output.todos) ||
    result.output.todos.length > MAX_TODO_ITEMS
  ) {
    return null;
  }

  const items: PublicTodoItem[] = [];
  for (const value of result.output.todos) {
    const item = projectTodoItem(value);
    if (!item) return null;
    items.push(item);
  }
  return items;
}

function projectTodoItem(value: unknown): PublicTodoItem | null {
  if (
    !isRecord(value) ||
    typeof value.content !== "string" ||
    value.content.length === 0 ||
    !fits(value.content, MAX_TODO_CONTENT_CHARACTERS) ||
    !isTodoPriority(value.priority) ||
    !isTodoStatus(value.status)
  ) {
    return null;
  }
  return {
    content: value.content,
    priority: value.priority,
    status: value.status,
  };
}

function fits(value: string, limit: number): boolean {
  return value.length > 0 && withinLimit(value, limit);
}

function withinLimit(value: string, limit: number): boolean {
  return Array.from(value).length <= limit;
}

function isTodoPriority(
  value: unknown,
): value is PublicTodoItem["priority"] {
  return value === "high" || value === "medium" || value === "low";
}

function isTodoStatus(value: unknown): value is PublicTodoItem["status"] {
  return (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
