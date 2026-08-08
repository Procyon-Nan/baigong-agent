import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const MAX_REQUEST_BYTES = 1_000_000;

export const FAKE_CHAT_MODELS = {
  success: "p3-fake-success",
  streaming: "p3-fake-stream",
  attachmentTools: "p5-fake-attachment-tools",
  partialFailure: "p3-fake-partial-failure",
  retry: "p3-fake-retry",
  timeout: "p3-fake-timeout",
  error: "p3-fake-error",
} as const;

export type FakeChatCompletionsServer = {
  readonly baseUrl: string;
  readonly requests: ReadonlyMap<string, number>;
  readonly observations: ReadonlyMap<
    string,
    readonly FakeChatRequestObservation[]
  >;
  close(): Promise<void>;
};

export type FakeChatRequestObservation = {
  readonly stream: boolean;
  readonly hasImageDataUrl: boolean;
  readonly hasPdfDataUrl: boolean;
  readonly toolRoleContainsDataUrl: boolean;
};

export async function startFakeChatCompletionsServer(options: {
  readonly apiKey?: string;
} = {}): Promise<FakeChatCompletionsServer> {
  const requests = new Map<string, number>();
  const observations = new Map<string, FakeChatRequestObservation[]>();
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(
        request,
        response,
        requests,
        observations,
        options.apiKey,
      );
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
    observations,
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
  observations: Map<string, FakeChatRequestObservation[]>,
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
  const modelObservations = observations.get(model) ?? [];
  modelObservations.push(observeRequest(body));
  observations.set(model, modelObservations);

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

  if (model === FAKE_CHAT_MODELS.attachmentTools) {
    writeAttachmentToolResponse(response, body, requestCount);
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

function observeRequest(
  body: Readonly<Record<string, unknown>>,
): FakeChatRequestObservation {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const serializedMessages = JSON.stringify(messages);
  const toolMessages = JSON.stringify(
    messages.filter(
      (message) =>
        isRecord(message) && message.role === "tool",
    ),
  );
  return {
    stream: body.stream === true,
    hasImageDataUrl: serializedMessages.includes("data:image/"),
    hasPdfDataUrl: serializedMessages.includes("data:application/pdf"),
    toolRoleContainsDataUrl:
      toolMessages.includes("data:image/") ||
      toolMessages.includes("data:application/pdf"),
  };
}

function writeAttachmentToolResponse(
  response: ServerResponse,
  body: Readonly<Record<string, unknown>>,
  requestCount: number,
): void {
  if (requestCount === 1) {
    writeToolCall(
      response,
      FAKE_CHAT_MODELS.attachmentTools,
      "call-list-attachments",
      "list_conversation_attachments",
      {},
    );
    return;
  }
  if (requestCount === 2) {
    const attachmentId = findAttachmentId(body.messages);
    if (!attachmentId) {
      writeJson(response, 400, {
        error: {
          type: "invalid_request_error",
          message: "The attachment list did not contain an attachment id.",
        },
      });
      return;
    }
    writeToolCall(
      response,
      FAKE_CHAT_MODELS.attachmentTools,
      "call-read-attachment",
      "read_conversation_attachment",
      { attachmentId },
    );
    return;
  }
  if (requestCount === 3) {
    writeStreamingText(
      response,
      FAKE_CHAT_MODELS.attachmentTools,
      "P5 attachment tool response",
    );
    return;
  }
  writeJson(response, 400, {
    error: {
      type: "invalid_request_error",
      message: "Unexpected extra attachment tool model step.",
    },
  });
}

function findAttachmentId(messages: unknown): string | null {
  const match = JSON.stringify(messages ?? null).match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
  return match?.[0] ?? null;
}

function writeToolCall(
  response: ServerResponse,
  model: string,
  callId: string,
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): void {
  startEventStream(response);
  response.write(
    `data: ${JSON.stringify({
      id: "chatcmpl-p5-fake-tool",
      object: "chat.completion.chunk",
      created: 1_785_376_800,
      model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: callId,
                type: "function",
                function: {
                  name: toolName,
                  arguments: JSON.stringify(input),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })}\n\n`,
  );
  writeChunk(response, model, "", "tool_calls");
  response.end("data: [DONE]\n\n");
}

function writeStreamingText(
  response: ServerResponse,
  model: string,
  content: string,
): void {
  startEventStream(response);
  writeChunk(response, model, content, null);
  writeChunk(response, model, "", "stop");
  response.end("data: [DONE]\n\n");
}

function startEventStream(response: ServerResponse): void {
  response.writeHead(200, {
    "cache-control": "no-store",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  finishReason: "stop" | "tool_calls" | null,
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
