import { describe, expect, test } from "vitest";
import { EnvironmentError, parseEnv } from "../src/env";

const VALID = {
  DATABASE_URL: "postgres://openokr:secret@localhost:5432/openokr",
};

describe("parseEnv", () => {
  test("accepts a valid environment", () => {
    const env = parseEnv(VALID);

    expect(env.DATABASE_URL).toBe(VALID.DATABASE_URL);
  });

  test("rejects a missing database URL", () => {
    expect(() => parseEnv({})).toThrow(EnvironmentError);
  });

  test("names the bad variable in the error message", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  test("rejects a database URL that is not a postgres URL", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: "mysql://localhost:3306/openokr" }),
    ).toThrow(/DATABASE_URL/);
  });

  test("reports every bad variable at once, not just the first", () => {
    const error = captureError(() => parseEnv({ NODE_ENV: "banana" }));

    expect(error.message).toMatch(/DATABASE_URL/);
    expect(error.message).toMatch(/NODE_ENV/);
  });

  test("never puts a variable's value in the error message", () => {
    const secret = "postgres://user:hunter2@localhost:5432/db?sslmode=nonsense";
    const error = captureError(() =>
      parseEnv({ DATABASE_URL: secret, NODE_ENV: "banana" }),
    );

    expect(error.message).not.toContain("hunter2");
  });

  test("defaults NODE_ENV to development so a bare checkout boots", () => {
    expect(parseEnv(VALID).NODE_ENV).toBe("development");
  });

  test("accepts the environments the deployment targets use", () => {
    for (const value of ["development", "test", "production"] as const) {
      expect(parseEnv({ ...VALID, NODE_ENV: value }).NODE_ENV).toBe(value);
    }
  });

  test("treats a blank variable as missing rather than as an empty string", () => {
    expect(() => parseEnv({ DATABASE_URL: "   " })).toThrow(/DATABASE_URL/);
  });

  test("defaults the log level and accepts an override", () => {
    expect(parseEnv(VALID).LOG_LEVEL).toBe("info");
    expect(parseEnv({ ...VALID, LOG_LEVEL: "debug" }).LOG_LEVEL).toBe("debug");
  });

  test("defaults the port and coerces it from a string", () => {
    expect(parseEnv(VALID).PORT).toBe(3000);
    expect(parseEnv({ ...VALID, PORT: "8080" }).PORT).toBe(8080);
  });

  test("rejects a port that is not a number", () => {
    expect(() => parseEnv({ ...VALID, PORT: "http" })).toThrow(/PORT/);
  });

  test("leaves the admin database URL unset unless provided", () => {
    expect(parseEnv(VALID).DATABASE_ADMIN_URL).toBeUndefined();
    expect(
      parseEnv({ ...VALID, DATABASE_ADMIN_URL: "postgres://owner@db/openokr" })
        .DATABASE_ADMIN_URL,
    ).toBe("postgres://owner@db/openokr");
  });

  test("rejects an admin database URL that is not postgres", () => {
    expect(() =>
      parseEnv({ ...VALID, DATABASE_ADMIN_URL: "mysql://nope" }),
    ).toThrow(/DATABASE_ADMIN_URL/);
  });
});

function captureError(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }

  throw new Error("expected the call to throw, but it returned");
}
