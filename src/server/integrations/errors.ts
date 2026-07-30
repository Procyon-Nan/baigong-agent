import { ApplicationError } from "@/src/server/errors";

export function clientNotFound(): ApplicationError {
  return new ApplicationError({
    code: "EMBEDDED_CLIENT_NOT_FOUND",
    message: "嵌入客户端不存在。",
    status: 404,
    expose: true,
  });
}

export function invalidClientOperation(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_EMBEDDED_CLIENT",
    message: "嵌入客户端配置无效。",
    status: 400,
    expose: true,
  });
}

export function invalidClientCredentials(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_CLIENT_CREDENTIALS",
    message: "客户端认证失败。",
    status: 401,
    expose: true,
  });
}

export function invalidTicketRequest(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_TICKET_REQUEST",
    message: "票据申请无效。",
    status: 400,
    expose: true,
  });
}

export function invalidTicket(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_EMBEDDED_TICKET",
    message: "嵌入票据无效或已过期。",
    status: 401,
    expose: true,
  });
}

export function integrationFailure(): ApplicationError {
  return new ApplicationError({
    code: "EMBEDDED_INTEGRATION_FAILURE",
    message: "嵌入认证失败。",
  });
}
