import { describe, expect, it } from "vitest";
import { configureP3TestDatabase } from "./support/p3-test-database";

describe("P3 test database configuration", () => {
  it("rejects a missing dedicated test database", () => {
    expect(() => configureP3TestDatabase({})).toThrow(
      "P3_TEST_DATABASE_URL is required",
    );
  });

  it("rejects the application database through an equivalent URL", () => {
    expect(() =>
      configureP3TestDatabase({
        DATABASE_URL: "postgresql://app@localhost:5432/baigong_agent",
        P3_TEST_DATABASE_URL:
          "postgres://tester@127.0.0.1/baigong_agent?sslmode=disable",
      }),
    ).toThrow("must identify a database separate from DATABASE_URL");
  });

  it("selects an explicitly separate P3 test database", () => {
    const environment: Record<string, string | undefined> = {
      DATABASE_URL: "postgresql://app@localhost/baigong_agent",
      P3_TEST_DATABASE_URL:
        "postgresql://tester@localhost/baigong_agent_p3_test",
    };

    expect(configureP3TestDatabase(environment)).toBe(
      environment.P3_TEST_DATABASE_URL,
    );
    expect(environment.DATABASE_URL).toBe(environment.P3_TEST_DATABASE_URL);
  });
});
