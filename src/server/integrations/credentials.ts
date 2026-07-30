import { ApplicationError } from "@/src/server/errors";

export function parseClientCredentials(request: Request): {
  readonly clientId: string;
  readonly clientSecret: string;
} {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) throw invalidCredentials();
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString(
      "utf8",
    );
    const separator = decoded.indexOf(":");
    if (separator < 1) throw invalidCredentials();
    const clientId = decoded.slice(0, separator);
    const clientSecret = decoded.slice(separator + 1);
    if (!clientId || !clientSecret) throw invalidCredentials();
    return { clientId, clientSecret };
  } catch {
    throw invalidCredentials();
  }
}

function invalidCredentials(): ApplicationError {
  return new ApplicationError({
    code: "INVALID_CLIENT_CREDENTIALS",
    message: "客户端认证失败。",
    status: 401,
    expose: true,
  });
}
