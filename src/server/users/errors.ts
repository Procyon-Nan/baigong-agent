import { ApplicationError } from "@/src/server/errors";

export function userNotFound(): ApplicationError {
  return new ApplicationError({
    code: "USER_NOT_FOUND",
    message: "用户不存在。",
    status: 404,
    expose: true,
  });
}

export function invalidUserOperation(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_USER_OPERATION",
    message: "该用户不支持此操作。",
    status: 400,
    expose: true,
  });
}
