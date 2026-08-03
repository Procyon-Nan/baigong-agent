import "server-only";

import {
  Client,
  ClientError,
  type HandleMessageStreamEvent,
} from "eve/client";
import { readApplicationOrigin } from "@/src/server/config/environment";
import { issueEveServiceToken } from "./tokens";
import type {
  EveAcceptedTurn,
  EveGateway,
  EveServiceIdentity,
} from "@/src/server/conversations/types";

export class EveGatewayRejectedError extends Error {
  readonly status: number;

  constructor(status: number, cause: unknown) {
    super("The eve runtime rejected the request.", { cause });
    this.name = "EveGatewayRejectedError";
    this.status = status;
  }
}

export function createEveGateway(options: {
  readonly host?: string;
  readonly issueToken?: (identity: EveServiceIdentity) => Promise<string>;
} = {}): EveGateway {
  const host = options.host ?? readApplicationOrigin();
  const issueToken = options.issueToken ?? defaultIssueToken;

  return {
    async startTurn({ identity, message }): Promise<EveAcceptedTurn> {
      const session = createClient(host, identity, issueToken).session();
      try {
        const response = await session.send({
          message,
          streamReconnectPolicy: { reconnect: false },
        });
        return acceptedTurn(response);
      } catch (error) {
        throw normalizeEveError(error);
      }
    },

    async continueTurn(input): Promise<EveAcceptedTurn> {
      const session = createClient(host, input.identity, issueToken).session({
        sessionId: input.sessionId,
        continuationToken: input.continuationToken,
        streamIndex: input.streamIndex,
      });
      try {
        const response = await session.send({
          message: input.message,
          streamReconnectPolicy: { reconnect: false },
        });
        return acceptedTurn(response);
      } catch (error) {
        throw normalizeEveError(error);
      }
    },

    async cancelTurn(input): Promise<"accepted" | "no_active_turn"> {
      const session = createClient(host, input.identity, issueToken).session({
        sessionId: input.sessionId,
        streamIndex: 0,
      });
      try {
        const result = await session.cancel(
          input.eveTurnId ? { turnId: input.eveTurnId } : undefined,
        );
        return result.status;
      } catch (error) {
        throw normalizeEveError(error);
      }
    },

    streamSession(input): AsyncIterable<HandleMessageStreamEvent> {
      const session = createClient(
        host,
        input.identity,
        issueToken,
      ).session({
        sessionId: input.sessionId,
        streamIndex: input.startIndex,
      });
      return session.stream({
        startIndex: input.startIndex,
        follow: input.follow,
        signal: input.signal,
        streamReconnectPolicy: { reconnect: false },
      });
    },
  };
}

function createClient(
  host: string,
  identity: EveServiceIdentity,
  issueToken: (identity: EveServiceIdentity) => Promise<string>,
): Client {
  return new Client({
    host,
    auth: { bearer: () => issueToken(identity) },
    redirect: "manual",
    preserveCompletedSessions: true,
  });
}

function acceptedTurn(response: {
  readonly sessionId: string;
  readonly continuationToken?: string;
  [Symbol.asyncIterator](): AsyncIterator<HandleMessageStreamEvent>;
}): EveAcceptedTurn {
  if (!response.sessionId) throw new Error("eve returned no session id.");
  return {
    sessionId: response.sessionId,
    continuationToken: response.continuationToken ?? null,
    events: response,
  };
}

async function defaultIssueToken(identity: EveServiceIdentity): Promise<string> {
  return (await issueEveServiceToken(identity)).token;
}

function normalizeEveError(error: unknown): unknown {
  if (error instanceof ClientError) {
    return new EveGatewayRejectedError(error.status, error);
  }
  return error;
}
