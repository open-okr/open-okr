import { describe, expect, test } from "vitest";
import {
  DEVELOPMENT_AUTH_SECRET,
  EnvironmentError,
  parseEnv,
} from "../src/env";

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
      // Production additionally requires a real auth secret; the placeholder
      // refusal has its own test below.
      const source = {
        ...VALID,
        NODE_ENV: value,
        ...(value === "production"
          ? { BETTER_AUTH_SECRET: "a-real-secret-value-of-sufficient-length" }
          : {}),
      };
      expect(parseEnv(source).NODE_ENV).toBe(value);
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

  test("defaults the auth secret and URL so a fresh checkout boots", () => {
    const env = parseEnv(VALID);
    expect(env.BETTER_AUTH_SECRET).toBe(DEVELOPMENT_AUTH_SECRET);
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
  });

  test("refuses to boot production with the placeholder auth secret", () => {
    const error = captureError(() =>
      parseEnv({ ...VALID, NODE_ENV: "production" }),
    );
    expect(error.message).toMatch(/BETTER_AUTH_SECRET/);
    expect(error.message).toMatch(/placeholder/i);
    expect((error as EnvironmentError).variables).toEqual([
      "BETTER_AUTH_SECRET",
    ]);
  });

  test("accepts production with a real auth secret", () => {
    const env = parseEnv({
      ...VALID,
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "a-real-secret-value-of-sufficient-length",
    });
    expect(env.NODE_ENV).toBe("production");
  });

  test("allows the placeholder outside production, where it is the point", () => {
    expect(() => parseEnv({ ...VALID, NODE_ENV: "development" })).not.toThrow();
    expect(() => parseEnv({ ...VALID, NODE_ENV: "test" })).not.toThrow();
  });

  test("rejects an auth secret that is too short to be worth having", () => {
    expect(() => parseEnv({ ...VALID, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  test("rejects an auth URL that is not a URL", () => {
    expect(() => parseEnv({ ...VALID, BETTER_AUTH_URL: "not-a-url" })).toThrow(
      /BETTER_AUTH_URL/,
    );
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

describe("S3 storage", () => {
  test("unset means local disk, which is the default a self-host needs", () => {
    const env = parseEnv(VALID);
    expect(env.OPENOKR_STORAGE_S3_BUCKET).toBeUndefined();
    expect(env.OPENOKR_STORAGE_ROOT).toBe("storage");
  });

  test("a named bucket with no credentials is a boot error naming them", () => {
    // The failure worth catching here rather than at the first upload: the
    // driver would build fine, every request would fail, and the message a
    // user saw would be about their file rather than about a missing variable.
    expect(() =>
      parseEnv({ ...VALID, OPENOKR_STORAGE_S3_BUCKET: "openokr-files" }),
    ).toThrow(/OPENOKR_STORAGE_S3_ACCESS_KEY_ID/);
  });

  test("half a credential pair is still refused", () => {
    expect(() =>
      parseEnv({
        ...VALID,
        OPENOKR_STORAGE_S3_BUCKET: "openokr-files",
        OPENOKR_STORAGE_S3_ACCESS_KEY_ID: "key",
      }),
    ).toThrow(/OPENOKR_STORAGE_S3_SECRET_ACCESS_KEY/);
  });

  test("a complete configuration parses, with a region default", () => {
    const env = parseEnv({
      ...VALID,
      OPENOKR_STORAGE_S3_BUCKET: "openokr-files",
      OPENOKR_STORAGE_S3_ACCESS_KEY_ID: "key",
      OPENOKR_STORAGE_S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(env.OPENOKR_STORAGE_S3_BUCKET).toBe("openokr-files");
    // Required by the SDK even for services that ignore it, so it has a
    // default rather than being a fourth thing to set for MinIO.
    expect(env.OPENOKR_STORAGE_S3_REGION).toBe("us-east-1");
    expect(env.OPENOKR_STORAGE_S3_ENDPOINT).toBeUndefined();
  });

  test("an endpoint that is not a URL is refused", () => {
    expect(() =>
      parseEnv({
        ...VALID,
        OPENOKR_STORAGE_S3_BUCKET: "openokr-files",
        OPENOKR_STORAGE_S3_ACCESS_KEY_ID: "key",
        OPENOKR_STORAGE_S3_SECRET_ACCESS_KEY: "secret",
        OPENOKR_STORAGE_S3_ENDPOINT: "localhost:9000",
      }),
    ).toThrow(/OPENOKR_STORAGE_S3_ENDPOINT/);
  });

  test("credentials never appear in the error message", () => {
    // Rule 2 of this file: boot errors end up in logs and these variables hold
    // credentials.
    try {
      parseEnv({
        ...VALID,
        OPENOKR_STORAGE_S3_BUCKET: "openokr-files",
        OPENOKR_STORAGE_S3_ACCESS_KEY_ID: "AKIAsupersecretvalue",
        OPENOKR_STORAGE_S3_ENDPOINT: "not-a-url",
      });
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as Error).message).not.toContain("AKIAsupersecretvalue");
    }
  });
});
