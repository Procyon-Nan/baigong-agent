import { describe, expect, it } from "vitest";
import { readDataDirectory, readServerEnvironment } from "@/src/server/config/environment";
import { ApplicationError } from "@/src/server/errors";

describe("server environment", () => {
  it("normalizes infrastructure configuration", () => {
    expect(
      readServerEnvironment(
        {
          DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
          BAIGONG_DATA_DIR: "runtime-data",
        },
        "/srv/app",
      ),
    ).toEqual({
      databaseUrl: "postgresql://user:pass@localhost:5432/app",
      dataDirectory: "/srv/app/runtime-data",
    });
  });

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() =>
      readServerEnvironment({ DATABASE_URL: "https://database.example.com" }),
    ).toThrow(ApplicationError);
  });

  it("defaults the project data directory without requiring database configuration", () => {
    expect(readDataDirectory({}, "/srv/app")).toBe("/srv/app/.data");
  });
});
