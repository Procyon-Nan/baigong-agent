type TestDatabaseEnvironment = {
  [name: string]: string | undefined;
  DATABASE_URL?: string;
  BAIGONG_DATA_DIR?: string;
  BAIGONG_APP_ORIGIN?: string;
};

export function configureDedicatedTestDatabase(
  phase: "P2" | "P3",
  environment: TestDatabaseEnvironment = process.env,
): string {
  const variableName = `${phase}_TEST_DATABASE_URL`;
  const testDatabaseUrl = environment[variableName]?.trim();
  if (!testDatabaseUrl) {
    throw new Error(
      `${variableName} is required for ${phase} database and HTTP tests.`,
    );
  }
  validatePostgresUrl(testDatabaseUrl, variableName);

  const applicationDatabaseUrl = environment.DATABASE_URL?.trim();
  if (
    applicationDatabaseUrl &&
    databaseIdentity(applicationDatabaseUrl) === databaseIdentity(testDatabaseUrl)
  ) {
    throw new Error(
      `${variableName} must identify a database separate from DATABASE_URL.`,
    );
  }

  environment.DATABASE_URL = testDatabaseUrl;
  environment.BAIGONG_DATA_DIR ??= `/tmp/baigong-agent-${phase.toLowerCase()}-tests`;
  environment.BAIGONG_APP_ORIGIN ??= "http://localhost:3000";
  return testDatabaseUrl;
}

function databaseIdentity(value: string): string {
  const url = validatePostgresUrl(value, "database URL");
  const hostname = ["localhost", "::1"].includes(url.hostname.toLowerCase())
    ? "127.0.0.1"
    : url.hostname.toLowerCase();
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return `${hostname}:${url.port || "5432"}/${databaseName}`;
}

function validatePostgresUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }
  if (
    !(url.protocol === "postgres:" || url.protocol === "postgresql:") ||
    !url.pathname.replace(/^\//, "")
  ) {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }
  return url;
}
