import { describe, expect, test } from "vitest";
import {
  callerAddressReading,
  describeCallerAddressReading,
} from "../src/caller-address";
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

  // docs/design/metrics-scrape-token.md D4, plan 0.7.0 B3.
  test("refuses a metrics scrape token shorter than 32 characters", () => {
    expect(() =>
      parseEnv({ ...VALID, OPENOKR_METRICS_TOKEN: "short-and-guessable" }),
    ).toThrow(/OPENOKR_METRICS_TOKEN/);
  });

  test("leaves the metrics scrape token unset by default", () => {
    expect(parseEnv(VALID).OPENOKR_METRICS_TOKEN).toBeUndefined();
  });

  // docs/design/error-reporting.md D14 and D15, plan 0.7.0 E2.
  test("sends errors nowhere by default, and names production", () => {
    const env = parseEnv(VALID);
    expect(env.OPENOKR_ERROR_DSN).toBeUndefined();
    expect(env.OPENOKR_ERROR_ENVIRONMENT).toBe("production");
    expect(
      parseEnv({ ...VALID, OPENOKR_ERROR_DSN: "" }).OPENOKR_ERROR_DSN,
    ).toBeUndefined();
  });

  test("accepts a DSN from any Sentry-protocol tracker", () => {
    for (const dsn of [
      "https://0123456789abcdef@o1.ingest.de.sentry.io/4508",
      "http://key@glitchtip:8000/1",
      "https://key@bugsink.example.com/errors/3",
    ]) {
      expect(
        parseEnv({ ...VALID, OPENOKR_ERROR_DSN: dsn }).OPENOKR_ERROR_DSN,
      ).toBe(dsn);
    }
  });

  test("refuses to boot on a DSN that is not one, naming the variable and not the value", () => {
    for (const dsn of [
      "not-a-dsn",
      "https://tracker.example.com/1",
      "ftp://key@tracker.example.com/1",
    ]) {
      const error = captureError(() =>
        parseEnv({ ...VALID, OPENOKR_ERROR_DSN: dsn }),
      );
      expect((error as EnvironmentError).variables).toEqual([
        "OPENOKR_ERROR_DSN",
      ]);
      expect(error.message).not.toContain(dsn);
    }
  });

  test("refuses an environment name that is not one word", () => {
    expect(() =>
      parseEnv({ ...VALID, OPENOKR_ERROR_ENVIRONMENT: "prod; drop" }),
    ).toThrow(/OPENOKR_ERROR_ENVIRONMENT/);
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

  test("a named bucket with no keys leaves the credentials to the AWS SDK", () => {
    // Plan 0.8.0 H9: workload identity (EKS Pod Identity, IRSA, an instance
    // profile) gives the pod a role and no key, and the SDK's default chain
    // finds it. Requiring a long-lived key made that impossible.
    const env = parseEnv({
      ...VALID,
      OPENOKR_STORAGE_S3_BUCKET: "openokr-files",
    });
    expect(env.OPENOKR_STORAGE_S3_BUCKET).toBe("openokr-files");
    expect(env.OPENOKR_STORAGE_S3_ACCESS_KEY_ID).toBeUndefined();
    expect(env.OPENOKR_STORAGE_S3_SECRET_ACCESS_KEY).toBeUndefined();
  });

  test("half a credential pair is still refused, either half", () => {
    // Half-configured is the state worth catching at boot: the driver would
    // build, and every upload would fail with a message about the file rather
    // than about the missing variable.
    expect(() =>
      parseEnv({
        ...VALID,
        OPENOKR_STORAGE_S3_BUCKET: "openokr-files",
        OPENOKR_STORAGE_S3_ACCESS_KEY_ID: "key",
      }),
    ).toThrow(/OPENOKR_STORAGE_S3_SECRET_ACCESS_KEY/);
    expect(() =>
      parseEnv({
        ...VALID,
        OPENOKR_STORAGE_S3_BUCKET: "openokr-files",
        OPENOKR_STORAGE_S3_SECRET_ACCESS_KEY: "secret",
      }),
    ).toThrow(/OPENOKR_STORAGE_S3_ACCESS_KEY_ID/);
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

/**
 * Whose address a request is counted under (docs/design/trusted-proxies.md
 * D1 to D8, plan 0.8.0 H2). Both variables are refused at boot when they are
 * malformed, naming the entry, because Better Auth on its own would drop a bad
 * range and carry on, and a dropped range turns that proxy into "the caller".
 */
describe("the caller address settings", () => {
  test("nothing set reads one forwarded address only", () => {
    const env = parseEnv(VALID);
    expect(env.OPENOKR_TRUSTED_PROXIES).toBeUndefined();
    expect(env.OPENOKR_CLIENT_ADDRESS_HEADER).toBeUndefined();
    expect(callerAddressReading({})).toEqual({ mode: "single_address" });
  });

  test("ranges are split on commas, spaces and newlines", () => {
    const env = parseEnv({
      ...VALID,
      OPENOKR_TRUSTED_PROXIES:
        "10.0.1.0/24, 2606:4700::/32\n173.245.48.0/20  192.0.2.10",
    });
    expect(env.OPENOKR_TRUSTED_PROXIES).toEqual([
      "10.0.1.0/24",
      "2606:4700::/32",
      "173.245.48.0/20",
      "192.0.2.10",
    ]);
    expect(
      callerAddressReading({ OPENOKR_TRUSTED_PROXIES: "10.0.1.0/24" }),
    ).toEqual({ mode: "trusted_proxies", trustedProxies: ["10.0.1.0/24"] });
  });

  test("the header is read in lower case", () => {
    expect(
      parseEnv({ ...VALID, OPENOKR_CLIENT_ADDRESS_HEADER: "CF-Connecting-IP" })
        .OPENOKR_CLIENT_ADDRESS_HEADER,
    ).toBe("cf-connecting-ip");
    expect(
      callerAddressReading({ OPENOKR_CLIENT_ADDRESS_HEADER: "X-Real-IP" }),
    ).toEqual({ mode: "header", header: "x-real-ip" });
  });

  test("a host name is refused, naming the variable and the entry", () => {
    const error = captureError(() =>
      parseEnv({
        ...VALID,
        OPENOKR_TRUSTED_PROXIES: "10.0.1.0/24, cloudflare",
      }),
    );
    expect(error).toBeInstanceOf(EnvironmentError);
    expect((error as EnvironmentError).variables).toContain(
      "OPENOKR_TRUSTED_PROXIES",
    );
    expect(error.message).toMatch(/OPENOKR_TRUSTED_PROXIES/);
    expect(error.message).toMatch(/cloudflare/);
  });

  test.each([
    ["0.0.0.0/0", /every address/],
    ["::/0", /every address/],
    ["::ffff:10.0.0.0/104", /as IPv4/],
    ["::ffff:10.0.1.5", /as IPv4/],
    ["10.0.1.0/33", /not an IP address or a CIDR range/],
    ["10.0.1.0/", /not an IP address or a CIDR range/],
    ["10.0.1.0/2x", /not an IP address or a CIDR range/],
    ["198.51.100.7:51234", /not an IP address or a CIDR range/],
  ])("%s is refused and the message says why", (entry, why) => {
    const error = captureError(() =>
      parseEnv({ ...VALID, OPENOKR_TRUSTED_PROXIES: entry }),
    );
    expect(error.message).toMatch(/OPENOKR_TRUSTED_PROXIES/);
    expect(error.message).toContain(entry);
    expect(error.message).toMatch(why);
  });

  test("both set is refused, naming both", () => {
    const error = captureError(() =>
      parseEnv({
        ...VALID,
        OPENOKR_TRUSTED_PROXIES: "10.0.1.0/24",
        OPENOKR_CLIENT_ADDRESS_HEADER: "cf-connecting-ip",
      }),
    );
    expect(error.message).toMatch(/OPENOKR_TRUSTED_PROXIES/);
    expect(error.message).toMatch(/OPENOKR_CLIENT_ADDRESS_HEADER/);
  });

  test("X-Forwarded-For as the header points to the ranges instead", () => {
    const error = captureError(() =>
      parseEnv({ ...VALID, OPENOKR_CLIENT_ADDRESS_HEADER: "X-Forwarded-For" }),
    );
    expect(error.message).toMatch(/OPENOKR_CLIENT_ADDRESS_HEADER/);
    expect(error.message).toMatch(/OPENOKR_TRUSTED_PROXIES/);
  });

  test("a header name that is not an HTTP token is refused", () => {
    const error = captureError(() =>
      parseEnv({ ...VALID, OPENOKR_CLIENT_ADDRESS_HEADER: "cf connecting ip" }),
    );
    expect(error.message).toMatch(/OPENOKR_CLIENT_ADDRESS_HEADER/);
    expect(error.message).toMatch(/header name/);
  });

  test("the running reading refuses what the boot refuses", () => {
    expect(() =>
      callerAddressReading({ OPENOKR_TRUSTED_PROXIES: "cloudflare" }),
    ).toThrow(EnvironmentError);
    expect(() =>
      callerAddressReading({
        OPENOKR_TRUSTED_PROXIES: "10.0.1.0/24",
        OPENOKR_CLIENT_ADDRESS_HEADER: "cf-connecting-ip",
      }),
    ).toThrow(/OPENOKR_CLIENT_ADDRESS_HEADER/);
  });

  test("blank means unset, as for every other variable", () => {
    expect(
      callerAddressReading({
        OPENOKR_TRUSTED_PROXIES: "  ",
        OPENOKR_CLIENT_ADDRESS_HEADER: "",
      }),
    ).toEqual({ mode: "single_address" });
  });

  test("the reading is described in one line for the boot log", () => {
    expect(describeCallerAddressReading({ mode: "single_address" })).toBe(
      "caller address: one forwarded address only",
    );
    expect(
      describeCallerAddressReading({
        mode: "trusted_proxies",
        trustedProxies: ["10.0.1.0/24", "10.0.2.0/24"],
      }),
    ).toBe("caller address: X-Forwarded-For, trusting 2 ranges");
    expect(
      describeCallerAddressReading({
        mode: "trusted_proxies",
        trustedProxies: ["10.0.1.0/24"],
      }),
    ).toBe("caller address: X-Forwarded-For, trusting 1 range");
    expect(
      describeCallerAddressReading({
        mode: "header",
        header: "cf-connecting-ip",
      }),
    ).toBe("caller address: the cf-connecting-ip header only");
  });
});

// docs/design/worker-deployment.md D8, plan 0.8.0 H10a.
describe("how long a stopping process may drain", () => {
  test("defaults to twenty seconds, so nothing has to be set", () => {
    expect(parseEnv(VALID).OPENOKR_SHUTDOWN_SECONDS).toBe(20);
    expect(
      parseEnv({ ...VALID, OPENOKR_SHUTDOWN_SECONDS: "" })
        .OPENOKR_SHUTDOWN_SECONDS,
    ).toBe(20);
  });

  test("takes a whole number of seconds from 1 to 300", () => {
    expect(
      parseEnv({ ...VALID, OPENOKR_SHUTDOWN_SECONDS: "1" })
        .OPENOKR_SHUTDOWN_SECONDS,
    ).toBe(1);
    expect(
      parseEnv({ ...VALID, OPENOKR_SHUTDOWN_SECONDS: "300" })
        .OPENOKR_SHUTDOWN_SECONDS,
    ).toBe(300);
  });

  test.each(["0", "301", "soon", "2.5"])(
    "refuses %s, naming the variable",
    (value) => {
      const error = captureError(() =>
        parseEnv({ ...VALID, OPENOKR_SHUTDOWN_SECONDS: value }),
      );
      expect(error).toBeInstanceOf(EnvironmentError);
      expect((error as EnvironmentError).variables).toEqual([
        "OPENOKR_SHUTDOWN_SECONDS",
      ]);
      expect(error.message).toMatch(/whole number of seconds from 1 to 300/);
    },
  );
});
