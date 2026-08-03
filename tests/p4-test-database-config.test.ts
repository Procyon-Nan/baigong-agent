import { describe, expect, it } from "vitest";
import { configureP4TestDatabase } from "./support/p4-test-database";

describe("P4 test database configuration", () => {
  it("rejects a missing dedicated test database", () => {
    expect(() => configureP4TestDatabase({})).toThrow(
      "P4_TEST_DATABASE_URL is required",
    );
  });

  it("rejects the application database through an equivalent URL", () => {
    expect(() =>
      configureP4TestDatabase({
        DATABASE_URL: "postgresql://app@localhost:5432/baigong_agent",
        P4_TEST_DATABASE_URL:
          "postgres://tester@127.0.0.1/baigong_agent?sslmode=disable",
      }),
    ).toThrow("must identify a database separate from DATABASE_URL");
  });

  it("selects an explicitly separate P4 test database", () => {
    const environment: Record<string, string | undefined> = {
      DATABASE_URL: "postgresql://app@localhost/baigong_agent",
      P4_TEST_DATABASE_URL:
        "postgresql://tester@localhost/baigong_agent_p4_test",
    };

    expect(configureP4TestDatabase(environment)).toBe(
      environment.P4_TEST_DATABASE_URL,
    );
    expect(environment.DATABASE_URL).toBe(environment.P4_TEST_DATABASE_URL);
  });
});
