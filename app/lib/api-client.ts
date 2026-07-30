export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(input, { ...init, headers });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiRequestError("服务器响应格式无效。", response.status);
  }

  if (!response.ok) {
    throw new ApiRequestError(errorMessage(payload), response.status);
  }
  return payload as T;
}

export function clientErrorMessage(
  error: unknown,
  fallback = "操作失败。",
): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function errorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "操作失败。";
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "操作失败。";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message ? message : "操作失败。";
}
