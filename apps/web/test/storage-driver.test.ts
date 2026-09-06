import { LocalDiskStorage, S3Storage } from "@openokr/adapters";
import { parseEnv } from "@openokr/config";
import { describe, expect, test } from "vitest";
import { storageDescription, storageDriverFor } from "../lib/storage";

/**
 * Which storage driver an environment asks for (P6-G05).
 *
 * The choice is one line and getting it wrong gives an instance that quietly
 * writes to the wrong place, so it is a pure function with a test rather than
 * an `if` inside a cached getter.
 */

const BASE = {
  DATABASE_URL: "postgres://openokr:secret@localhost:5432/openokr",
} as const;

const S3 = {
  OPENOKR_STORAGE_S3_BUCKET: "openokr-files",
  OPENOKR_STORAGE_S3_ACCESS_KEY_ID: "key",
  OPENOKR_STORAGE_S3_SECRET_ACCESS_KEY: "secret",
} as const;

describe("storageDriverFor", () => {
  test("an unconfigured instance gets local disk", () => {
    // The default that keeps Postgres the only required service.
    const storage = storageDriverFor(parseEnv(BASE));
    expect(storage).toBeInstanceOf(LocalDiskStorage);
  });

  test("naming a bucket is the whole switch", () => {
    const storage = storageDriverFor(parseEnv({ ...BASE, ...S3 }));
    expect(storage).toBeInstanceOf(S3Storage);
  });

  test("an endpoint reaches the driver, so MinIO and R2 work", async () => {
    const storage = storageDriverFor(
      parseEnv({
        ...BASE,
        ...S3,
        OPENOKR_STORAGE_S3_ENDPOINT: "http://localhost:9000",
      }),
    );
    expect(storage).toBeInstanceOf(S3Storage);
    // Constructed, not connected. Released here so the keep-alive pool does
    // not hold the test process open.
    await storage.stop();
  });
});

describe("storageDescription", () => {
  test("names the local root, which is what an operator looks for", () => {
    expect(storageDescription(parseEnv(BASE))).toBe("local disk at storage");
  });

  test("names the bucket and the service", () => {
    expect(
      storageDescription(
        parseEnv({
          ...BASE,
          ...S3,
          OPENOKR_STORAGE_S3_ENDPOINT: "http://minio.internal:9000",
        }),
      ),
    ).toBe("S3-compatible bucket openokr-files at http://minio.internal:9000");
  });

  test("says AWS when there is no endpoint", () => {
    expect(storageDescription(parseEnv({ ...BASE, ...S3 }))).toBe(
      "S3-compatible bucket openokr-files at AWS S3",
    );
  });

  test("never names a credential", () => {
    // It goes in a boot log and on the first-run wizard's own screen.
    const description = storageDescription(parseEnv({ ...BASE, ...S3 }));
    expect(description).not.toContain("secret");
    expect(description).not.toContain("key");
  });
});
