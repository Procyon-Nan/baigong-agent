export type PublicError = {
  readonly code: string;
  readonly message: string;
};

export class ApplicationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly expose: boolean;

  constructor(options: {
    readonly code: string;
    readonly message: string;
    readonly status?: number;
    readonly expose?: boolean;
    readonly cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "ApplicationError";
    this.code = options.code;
    this.status = options.status ?? 500;
    this.expose = options.expose ?? false;
  }
}

export function toPublicError(error: unknown): PublicError {
  if (error instanceof ApplicationError && error.expose) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "服务暂时不可用，请稍后重试。",
  };
}

export function errorStatus(error: unknown): number {
  return error instanceof ApplicationError ? error.status : 500;
}
