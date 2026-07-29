import { describe, expect, it } from "vitest";
import { ApplicationError, errorStatus, toPublicError } from "@/src/server/errors";

describe("public errors", () => {
  it("returns explicitly exposed application errors", () => {
    const error = new ApplicationError({
      code: "SERVICE_UNAVAILABLE",
      message: "服务尚未配置。",
      status: 503,
      expose: true,
    });

    expect(toPublicError(error)).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "服务尚未配置。",
    });
    expect(errorStatus(error)).toBe(503);
  });

  it("sanitizes unknown errors", () => {
    expect(toPublicError(new Error("secret detail"))).toEqual({
      code: "INTERNAL_ERROR",
      message: "服务暂时不可用，请稍后重试。",
    });
  });
});
