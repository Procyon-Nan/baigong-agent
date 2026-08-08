export type PublicInteractionOrigin = "MAIN" | "SUBAGENT";

export type PublicInputOption = {
  readonly id: string;
  readonly label: string;
  readonly description: string | null;
  readonly style: "default" | "primary" | "danger" | null;
};

export type PublicInputRequest = {
  readonly requestId: string;
  readonly prompt: string;
  readonly display: "text" | "confirmation" | "select" | null;
  readonly allowFreeform: boolean;
  readonly options: readonly PublicInputOption[];
};

export type PublicPendingInput = {
  readonly origin: PublicInteractionOrigin;
  readonly requests: readonly PublicInputRequest[];
};

export type PublicTodoItem = {
  readonly content: string;
  readonly priority: "high" | "medium" | "low";
  readonly status: "pending" | "in_progress" | "completed" | "cancelled";
};

export type PublicConversationUiState = {
  readonly todos: readonly PublicTodoItem[];
  readonly pendingInput: PublicPendingInput | null;
};
