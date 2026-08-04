import { ApplicationError } from "@/src/server/errors";

export function conversationNotFound(): ApplicationError {
  return new ApplicationError({
    code: "CONVERSATION_NOT_FOUND",
    message: "对话不存在。",
    status: 404,
    expose: true,
  });
}

export function conversationBusy(): ApplicationError {
  return new ApplicationError({
    code: "CONVERSATION_BUSY",
    message: "当前对话正在生成回复。",
    status: 409,
    expose: true,
  });
}

export function conversationUnavailable(): ApplicationError {
  return new ApplicationError({
    code: "CONVERSATION_UNAVAILABLE",
    message: "当前对话暂时不可用。",
    status: 409,
    expose: true,
  });
}

export function conversationQuotaExceeded(): ApplicationError {
  return new ApplicationError({
    code: "CONVERSATION_LIMIT_REACHED",
    message: "未归档主会话数量已达到上限。",
    status: 409,
    expose: true,
  });
}

export function invalidConversationCursor(cause?: unknown): ApplicationError {
  return new ApplicationError({
    code: "INVALID_CONVERSATION_CURSOR",
    message: "对话分页游标无效。",
    status: 400,
    expose: true,
    cause,
  });
}

export function conversationAuthenticationExpired(): ApplicationError {
  return new ApplicationError({
    code: "AUTHENTICATION_EXPIRED",
    message: "登录状态已失效，请重新登录。",
    status: 401,
    expose: true,
  });
}

export function userConcurrencyLimit(): ApplicationError {
  return new ApplicationError({
    code: "USER_CONCURRENCY_LIMIT",
    message: "同时生成的回复数量已达上限。",
    status: 429,
    expose: true,
  });
}

export function turnChanged(): ApplicationError {
  return new ApplicationError({
    code: "TURN_CHANGED",
    message: "当前回复已发生变化，请刷新后重试。",
    status: 409,
    expose: true,
  });
}

export function eveRequestRejected(cause?: unknown): ApplicationError {
  return new ApplicationError({
    code: "EVE_REQUEST_REJECTED",
    message: "对话运行时拒绝了请求。",
    status: 502,
    cause,
  });
}

export function conversationPersistenceFailure(cause?: unknown): ApplicationError {
  return new ApplicationError({
    code: "CONVERSATION_PERSISTENCE_FAILED",
    message: "对话状态保存失败。",
    cause,
  });
}
