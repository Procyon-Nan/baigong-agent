import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const MAX_REQUEST_BYTES = 1_000_000;

export const FAKE_CHAT_MODELS = {
  success: "p3-fake-success",
  streaming: "p3-fake-stream",
  partialFailure: "p3-fake-partial-failure",
  retry: "p3-fake-retry",
  timeout: "p3-fake-timeout",
  error: "p3-fake-error",
} as const;

export type FakeChatCompletionsServer = {
  readonly baseUrl: string;
  readonly requests: ReadonlyMap<string, number>;
  close(): Promise<void>;
};

export async function startFakeChatCompletionsServer(options: {
  readonly apiKey?: string;
} = {}): Promise<FakeChatCompletionsServer> {
  const requests = new Map<string, number>();
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, requests, options.apiKey);
    } catch (error) {
      if (!response.headersSent) {
        writeJson(response, 500, {
          error: {
            type: "fake_server_error",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        });
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    async close() {
      const closed = once(server, "close");
      server.close();
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: Map<string, number>,
  apiKey: string | undefined,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    writeJson(response, 404, {
      error: { type: "not_found", message: "Fake endpoint not found." },
    });
    return;
  }
  if (
    apiKey !== undefined &&
    request.headers.authorization !== `Bearer ${apiKey}`
  ) {
    writeJson(response, 401, {
      error: { type: "authentication_error", message: "Invalid fake API key." },
    });
    return;
  }

  const body = await readJsonBody(request);
  const model = typeof body.model === "string" ? body.model : "";
  const requestCount = (requests.get(model) ?? 0) + 1;
  requests.set(model, requestCount);

  if (model === FAKE_CHAT_MODELS.error) {
    writeJson(response, 400, {
      error: {
        type: "invalid_request_error",
        code: "fake_invalid_model_request",
        message: "The fake provider rejected this request.",
      },
    });
    return;
  }
  if (model === FAKE_CHAT_MODELS.retry && requestCount < 3) {
    writeJson(response, 503, {
      error: {
        type: "server_error",
        code: "fake_retryable_failure",
        message: "The fake provider is temporarily unavailable.",
      },
    });
    return;
  }
  if (model === FAKE_CHAT_MODELS.timeout) {
    await new Promise<void>((resolve) => request.socket.once("close", resolve));
    return;
  }

  const stream = body.stream === true;
  if (!stream) {
    writeJson(response, 200, completion(model, "P3 fake response"));
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
  writeChunk(response, model, "P3 fake ", null);
  if (model === FAKE_CHAT_MODELS.partialFailure) {
    response.socket?.destroy(new Error("Intentional partial stream failure."));
    return;
  }
  writeChunk(response, model, "response", null);
  writeChunk(response, model, "", "stop");
  response.end("data: [DONE]\n\n");
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Fake request is too large.");
    chunks.push(value);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Fake request body must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function completion(model: string, content: string): Record<string, unknown> {
  return {
    id: "chatcmpl-p3-fake",
    object: "chat.completion",
    created: 1_785_376_800,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
  };
}

function writeChunk(
  response: ServerResponse,
  model: string,
  content: string,
  finishReason: "stop" | null,
): void {
  response.write(
    `data: ${JSON.stringify({
      id: "chatcmpl-p3-fake",
      object: "chat.completion.chunk",
      created: 1_785_376_800,
      model,
      choices: [
        {
          index: 0,
          delta: finishReason ? {} : { content },
          finish_reason: finishReason,
        },
      ],
    })}\n\n`,
  );
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}
