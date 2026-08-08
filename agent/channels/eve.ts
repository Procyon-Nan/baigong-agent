import { eveChannel } from "eve/channels/eve";
import {
  extractBearerToken,
  UnauthenticatedError,
  withAuthChallenges,
  type AuthFn,
} from "eve/channels/auth";
import { authorizeEveServiceRequest } from "../../src/server/eve/authorization";
import { verifyEveServiceToken } from "../../src/server/eve/tokens";

type ServiceTokenVerifier = typeof verifyEveServiceToken;
type ServiceRequestAuthorizer = typeof authorizeEveServiceRequest;

export function createBffServiceAuth(
  options: {
    readonly verifyToken?: ServiceTokenVerifier;
    readonly authorizeRequest?: ServiceRequestAuthorizer;
  } = {},
): AuthFn<Request> {
  const verifyToken = options.verifyToken ?? verifyEveServiceToken;
  const authorizeRequest =
    options.authorizeRequest ?? authorizeEveServiceRequest;
  return withAuthChallenges<Request>(
    async (request) => {
      const token = extractBearerToken(request.headers.get("authorization"));
      if (!token) return null;

      try {
        const claims = await verifyToken(token);
        if (!(await authorizeRequest(claims, request))) {
          throw new Error("Unauthorized claims.");
        }
        return {
          attributes: {
            tenantId: claims.tenantId,
            role: claims.role,
            source: claims.source,
            conversationId: claims.conversationId,
            turnId: claims.turnId,
            modelConfigVersionId: claims.modelConfigVersionId,
            agentConfigVersionId: claims.agentConfigVersionId,
          },
          authenticator: "baigong-bff",
          issuer: claims.iss,
          principalId: claims.userId,
          principalType: "user",
          subject: claims.sub,
        };
      } catch {
        throw new UnauthenticatedError({
          code: "invalid_service_token",
          message: "服务认证令牌无效。",
        });
      }
    },
    [{ scheme: "Bearer" }],
  );
}

export const bffServiceAuth = createBffServiceAuth();

export default eveChannel({
  auth: [bffServiceAuth],
  uploadPolicy: {
    allowedMediaTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
    ],
    maxBytes: 20 * 1_024 * 1_024,
  },
});
