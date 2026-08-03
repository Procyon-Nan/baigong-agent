import { defineChannel, GET } from "eve/channels";
import type { HandleMessageStreamEvent } from "eve/client";
import {
  extractBearerToken,
  routeAuth,
  UnauthenticatedError,
  withAuthChallenges,
} from "eve/channels/auth";
import {
  authorizeAdminConversationStream,
  type AdminStreamClaims,
  type AdminStreamTarget,
} from "@/src/server/eve/admin-stream";
import {
  verifyEveAdminStreamToken,
  type VerifiedEveAdminStreamToken,
} from "@/src/server/eve/tokens";
import { ApplicationError } from "@/src/server/errors";
import { errorResponse } from "@/src/server/http/responses";

type AdminStreamChannelDependencies = {
  readonly verifyToken: (
    token: string,
  ) => Promise<VerifiedEveAdminStreamToken>;
  readonly authorizeStream: (
    claims: AdminStreamClaims,
  ) => Promise<AdminStreamTarget>;
};

const defaultDependencies: AdminStreamChannelDependencies = {
  verifyToken: verifyEveAdminStreamToken,
  authorizeStream: authorizeAdminConversationStream,
};

export function createAdminStreamChannel(
  dependencies: AdminStreamChannelDependencies = defaultDependencies,
) {
  const authenticate = withAuthChallenges(
    async (request: Request) => {
      const token = extractBearerToken(request.headers.get("authorization"));
      if (!token) return null;
      try {
        const claims = await dependencies.verifyToken(token);
        return {
          authenticator: "baigong-admin-stream",
          principalType: "user",
          principalId: claims.administratorUserId,
          subject: claims.administratorUserId,
          issuer: claims.iss,
          attributes: {
            tenantId: claims.tenantId,
            conversationId: claims.conversationId,
            administratorUserId: claims.administratorUserId,
          },
        };
      } catch (error) {
        if (
          !(error instanceof ApplicationError) ||
          error.code !== "INVALID_EVE_TOKEN"
        ) {
          throw error;
        }
        throw new UnauthenticatedError({
          code: "invalid_token",
          message: "管理员事件流令牌无效。",
        });
      }
    },
    [{ scheme: "Bearer" }],
  );

  return defineChannel({
    routes: [
      GET("/eve/v1/admin/stream", async (request, { getSession }) => {
        const authentication = await routeAuth(request, authenticate);
        if (authentication instanceof Response) return authentication;

        const startIndex = parseStartIndex(
          new URL(request.url).searchParams.get("startIndex"),
        );
        if (startIndex === null) {
          return Response.json(
            {
              ok: false,
              code: "invalid_start_index",
              error: "事件流游标无效。",
            },
            { status: 400, headers: { "cache-control": "no-store" } },
          );
        }

        const claims = claimsFromAuthentication(authentication);
        try {
          const target = await dependencies.authorizeStream(claims);
          const events = await getSession(target.eveSessionId).getEventStream(
            { startIndex },
          );
          return new Response(serializeAsNdjson(events), {
            headers: {
              "cache-control": "no-store",
              "content-type": "application/x-ndjson; charset=utf-8",
              "x-content-type-options": "nosniff",
            },
          });
        } catch (error) {
          return errorResponse(error);
        }
      }),
    ],
  });
}

function serializeAsNdjson(
  events: ReadableStream<HandleMessageStreamEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return events.pipeThrough(
    new TransformStream<HandleMessageStreamEvent, Uint8Array>({
      transform(event, controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      },
    }),
  );
}

function claimsFromAuthentication(authentication: {
  readonly attributes: Readonly<Record<string, string | readonly string[]>>;
}): AdminStreamClaims {
  return {
    administratorUserId: authentication.attributes
      .administratorUserId as string,
    tenantId: authentication.attributes.tenantId as string,
    conversationId: authentication.attributes.conversationId as string,
  };
}

function parseStartIndex(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export default createAdminStreamChannel();
