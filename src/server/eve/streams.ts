import "server-only";

import { createHash } from "node:crypto";
import type { HandleMessageStreamEvent } from "eve/client";
import type { AuthenticatedPrincipal } from "@/src/server/auth/principal";
import {
  createAuthenticationExpiredEvent,
  createHeartbeatEvent,
  projectEveEvent,
  type PublicConversationErrorCode,
  type PublicConversationEvent,
} from "./projection";
import { createEveGateway } from "./client";
import { applyConversationEvent } from "@/src/server/conversations/lifecycle";
import {
  createConversationRepository,
  type ConversationStreamRepository,
} from "@/src/server/conversations/repository";
import { serviceIdentity } from "@/src/server/conversations/creation";
import {
  conversationAuthenticationExpired,
  conversationUnavailable,
} from "@/src/server/conversations/errors";
import type {
  EveGateway,
  RuntimeConversation,
} from "@/src/server/conversations/types";

export const STREAM_AUTHORIZATION_CACHE_MS = 2_000;
export const STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

export async function streamConversationEvents(input: {
  readonly principal: AuthenticatedPrincipal;
  readonly conversationId: string;
  readonly after: number;
  readonly reauthorize: () => Promise<AuthenticatedPrincipal | null>;
  readonly requestSignal?: AbortSignal;
  readonly repository?: ConversationStreamRepository;
  readonly eve?: EveGateway;
  readonly now?: () => Date;
  readonly heartbeatIntervalMs?: number;
  readonly authorizationCacheMs?: number;
}): Promise<ReadableStream<Uint8Array>> {
  const repository = input.repository ?? createConversationRepository();
  const eve = input.eve ?? createEveGateway();
  const now = input.now ?? (() => new Date());
  const runtime = await repository.getRuntimeConversation(
    input.principal,
    input.conversationId,
  );
  const eveSessionId = runtime.eveSessionId;
  if (!eveSessionId) throw conversationUnavailable();
  const currentPrincipal = await input.reauthorize();
  if (!currentPrincipal || !samePrincipal(input.principal, currentPrincipal)) {
    throw conversationAuthenticationExpired();
  }

  const localAbort = new AbortController();
  const signal = input.requestSignal
    ? AbortSignal.any([input.requestSignal, localAbort.signal])
    : localAbort.signal;
  const events = publicEventIterator({
    ...input,
    signal,
    repository,
    eve,
    now,
    runtime,
    eveSessionId,
    initialAuthorizationCheck: now().getTime(),
  });
  const iterator = events[Symbol.asyncIterator]();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
      } catch {
        controller.close();
      }
    },
    async cancel() {
      localAbort.abort();
      await iterator.return?.(undefined);
    },
  });
}

async function* publicEventIterator(input: {
  readonly principal: AuthenticatedPrincipal;
  readonly conversationId: string;
  readonly after: number;
  readonly reauthorize: () => Promise<AuthenticatedPrincipal | null>;
  readonly signal: AbortSignal;
  readonly repository: ConversationStreamRepository;
  readonly eve: EveGateway;
  readonly now: () => Date;
  readonly runtime: RuntimeConversation;
  readonly eveSessionId: string;
  readonly initialAuthorizationCheck: number;
  readonly heartbeatIntervalMs?: number;
  readonly authorizationCacheMs?: number;
}): AsyncGenerator<PublicConversationEvent> {
  const repository = input.repository;
  const eve = input.eve;
  const now = input.now;
  const heartbeatIntervalMs =
    input.heartbeatIntervalMs ?? STREAM_HEARTBEAT_INTERVAL_MS;
  const authorizationCacheMs =
    input.authorizationCacheMs ?? STREAM_AUTHORIZATION_CACHE_MS;
  const runtime = input.runtime;
  let lastAuthorizationCheck = input.initialAuthorizationCheck;
  const authorize = async (): Promise<"valid" | "expired" | "unavailable"> => {
    const currentTime = now().getTime();
    if (currentTime - lastAuthorizationCheck < authorizationCacheMs) {
      return "valid";
    }
    try {
      const current = await input.reauthorize();
      lastAuthorizationCheck = currentTime;
      return current && samePrincipal(input.principal, current)
        ? "valid"
        : "expired";
    } catch {
      return "unavailable";
    }
  };

  let cursor = Math.min(input.after + 1, runtime.nextStreamIndex);
  const rawIterator = eve
    .streamSession({
      identity: serviceIdentity(input.principal, runtime),
      sessionId: input.eveSessionId,
      startIndex: cursor,
      signal: input.signal,
    })
    [Symbol.asyncIterator]();
  let pending = rawIterator.next();

  try {
    while (!input.signal.aborted) {
      const next = await nextOrHeartbeat(pending, heartbeatIntervalMs);
      if (next.kind === "heartbeat") {
        const authorization = await authorize();
        if (authorization !== "valid") {
          if (authorization === "expired") {
            yield createAuthenticationExpiredEvent({
              conversationId: input.conversationId,
              cursor: cursor - 1,
              at: now().toISOString(),
            });
          }
          return;
        }
        yield createHeartbeatEvent({
          conversationId: input.conversationId,
          cursor: cursor - 1,
          at: now().toISOString(),
        });
        continue;
      }
      if (next.value.done) return;
      const event = next.value.value;
      pending = rawIterator.next();

      await applyConversationEvent(
        input.conversationId,
        cursor,
        event,
        repository,
      );
      const authorization = await authorize();
      if (authorization !== "valid") {
        if (authorization === "expired") {
          yield createAuthenticationExpiredEvent({
            conversationId: input.conversationId,
            cursor: cursor - 1,
            at: now().toISOString(),
          });
        }
        return;
      }

      const projected = await projectEvent(
        repository,
        input.conversationId,
        cursor,
        event,
      );
      cursor += 1;
      if (projected) yield projected;
    }
  } finally {
    await rawIterator.return?.();
  }
}

async function projectEvent(
  repository: ConversationStreamRepository,
  conversationId: string,
  cursor: number,
  event: HandleMessageStreamEvent,
): Promise<PublicConversationEvent | null> {
  const eveTurnId = eventTurnId(event);
  const turn = eveTurnId
    ? await repository.findProjectionTurn(conversationId, eveTurnId)
    : null;
  return projectEveEvent(event, {
    conversationId,
    cursor,
    turnId: turn?.turnId,
    eveTurnId: eveTurnId ?? undefined,
    assistantBlockId: turn ? assistantBlockId(conversationId, turn.turnId) : undefined,
    failureCode: publicFailureCode(turn?.publicErrorCode),
  });
}

function eventTurnId(event: HandleMessageStreamEvent): string | null {
  if (!("data" in event) || !event.data || typeof event.data !== "object") {
    return null;
  }
  return "turnId" in event.data && typeof event.data.turnId === "string"
    ? event.data.turnId
    : null;
}

function assistantBlockId(conversationId: string, turnId: string): string {
  return `blk_${createHash("sha256")
    .update(`${conversationId}:${turnId}`)
    .digest("base64url")
    .slice(0, 22)}`;
}

function publicFailureCode(
  value: string | null | undefined,
): PublicConversationErrorCode | undefined {
  return value === "MODEL_UNAVAILABLE" ||
    value === "REQUEST_FAILED" ||
    value === "CONVERSATION_UNAVAILABLE"
    ? value
    : undefined;
}

function samePrincipal(
  expected: AuthenticatedPrincipal,
  current: AuthenticatedPrincipal,
): boolean {
  return (
    expected.userId === current.userId &&
    expected.tenantId === current.tenantId &&
    expected.role === current.role &&
    expected.source === current.source &&
    expected.sessionId === current.sessionId
  );
}

async function nextOrHeartbeat<T>(
  pending: Promise<IteratorResult<T>>,
  heartbeatIntervalMs: number,
): Promise<
  | { readonly kind: "event"; readonly value: IteratorResult<T> }
  | { readonly kind: "heartbeat" }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending.then((value) => ({ kind: "event" as const, value })),
      new Promise<{ readonly kind: "heartbeat" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "heartbeat" }), heartbeatIntervalMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
