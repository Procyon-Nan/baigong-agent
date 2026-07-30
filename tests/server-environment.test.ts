import { describe, expect, it } from "vitest";
import {
  readDataDirectory,
  readServerEnvironment,
} from "@/src/server/config/environment";
import { ApplicationError } from "@/src/server/errors";

describe("server environment", () => {
  it("normalizes infrastructure configuration", () => {
    expect(
      readServerEnvironment(
        {
          DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
          BAIGONG_DATA_DIR: "runtime-data",
          BAIGONG_APP_ORIGIN: "http://localhost:3000",
        },
        "/srv/app",
      ),
    ).toEqual({
      databaseUrl: "postgresql://user:pass@localhost:5432/app",
      dataDirectory: "/srv/app/runtime-data",
      applicationOrigin: "http://localhost:3000",
    });
  });

  it("requires an exact HTTPS application origin in production", () => {
    expect(() =>
      readServerEnvironment({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
        NODE_ENV: "production",
      }),
    ).toThrow(ApplicationError);
    expect(
      readServerEnvironment({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
        BAIGONG_APP_ORIGIN: "https://agent.example.com",
        NODE_ENV: "production",
      }).applicationOrigin,
    ).toBe("https://agent.example.com");
    expect(
      readServerEnvironment({
        DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
        BAIGONG_APP_ORIGIN: "http://localhost:3100",
        NODE_ENV: "production",
      }).applicationOrigin,
    ).toBe("http://localhost:3100");
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
