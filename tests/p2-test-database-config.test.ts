import { describe, expect, it } from "vitest";
import { configureP2TestDatabase } from "./support/p2-test-database";

describe("P2 test database configuration", () => {
  it("rejects a missing dedicated test database", () => {
    expect(() => configureP2TestDatabase({})).toThrow(
      "P2_TEST_DATABASE_URL is required",
    );
  });

  it("rejects the application database even through an equivalent URL", () => {
    expect(() =>
      configureP2TestDatabase({
        DATABASE_URL: "postgresql://app@localhost:5432/baigong_agent",
        P2_TEST_DATABASE_URL:
          "postgres://tester@127.0.0.1/baigong_agent?sslmode=disable",
      }),
    ).toThrow("must identify a database separate from DATABASE_URL");
  });

  it("selects an explicitly separate P2 test database", () => {
    const environment: Record<string, string | undefined> = {
      DATABASE_URL: "postgresql://app@localhost/baigong_agent",
      P2_TEST_DATABASE_URL:
        "postgresql://tester@localhost/baigong_agent_p2_test",
    };

    expect(configureP2TestDatabase(environment)).toBe(
      environment.P2_TEST_DATABASE_URL,
    );
    expect(environment.DATABASE_URL).toBe(environment.P2_TEST_DATABASE_URL);
  });
});
