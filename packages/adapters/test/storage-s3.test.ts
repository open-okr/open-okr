import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { refuseUnsafeKey, S3Storage } from "../src/drivers/storage/s3.ts";
import { ObjectNotFoundError } from "../src/ports/storage.ts";

/**
 * The S3-compatible driver (P6-G05).
 *
 * Two halves, and the split is deliberate. Key handling and client lifecycle
 * need no network and always run, because they are where the defects that
 * differ from local disk actually live. The round trip needs a real
 * S3-compatible service and skips itself by name when there is none, the same
 * way the FlowyTeam connector's suites skip without a MySQL.
 *
 * Point it at anything compatible:
 *
 *   docker run -p 9000:9000 -e MINIO_ROOT_USER=minioadmin \
 *     -e MINIO_ROOT_PASSWORD=minioadmin quay.io/minio/minio server /data
 *
 *   TEST_S3_ENDPOINT=http://localhost:9000 TEST_S3_BUCKET=openokr-test \
 *   TEST_S3_ACCESS_KEY_ID=minioadmin TEST_S3_SECRET_ACCESS_KEY=minioadmin \
 *   pnpm --filter @openokr/adapters exec vitest run test/storage-s3.test.ts
 *
 * The bucket has to exist already. Creating it would need a second permission
 * this driver never asks for in production, and a driver that can make buckets
 * is a driver that can make one by accident.
 */

const endpoint = process.env.TEST_S3_ENDPOINT;
const bucket = process.env.TEST_S3_BUCKET;
const accessKeyId = process.env.TEST_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.TEST_S3_SECRET_ACCESS_KEY;

const SKIP_REASON =
  "Set TEST_S3_ENDPOINT, TEST_S3_BUCKET, TEST_S3_ACCESS_KEY_ID and " +
  "TEST_S3_SECRET_ACCESS_KEY to run it against a real S3-compatible service.";

const runnable = Boolean(endpoint && bucket && accessKeyId && secretAccessKey);
if (!runnable) {
  console.warn(`Skipping the S3 round-trip tests. ${SKIP_REASON}`);
}

/** A driver against nothing. Enough for every test that sends no request. */
const offline = (): S3Storage =>
  new S3Storage({
    bucket: "bucket-that-is-never-reached",
    region: "us-east-1",
    accessKeyId: "key",
    secretAccessKey: "secret",
    endpoint: "http://127.0.0.1:1",
  });

describe("keys behave the same way on both drivers", () => {
  it("refuses what the local driver refuses", () => {
    // On disk these escape the storage root. On S3 they are literal segments
    // and harmless, which is exactly why the check belongs here: a key one
    // driver refuses and the other accepts is a difference that surfaces only
    // after somebody migrates, with the wrong object in their hands.
    for (const key of [
      "",
      "/absolute",
      "../escape",
      "workspace/../../etc/passwd",
      "workspace/./same",
      "windows\\path",
    ]) {
      expect(() => refuseUnsafeKey(key), key).toThrow(/Invalid storage key/);
    }
  });

  it("accepts the keys the product actually builds", () => {
    for (const key of [
      "ws_01/blob_02",
      "ws_01/exports/2026-09-07.csv",
      "a.b/c-d_e/f.g.h",
    ]) {
      expect(() => refuseUnsafeKey(key), key).not.toThrow();
    }
  });

  it("refuses an unsafe key before any request leaves", async () => {
    // Against an endpoint that cannot answer, so a request reaching the network
    // would hang or connect-refuse rather than throwing this message.
    const storage = offline();
    await expect(storage.put("../escape", Buffer.from("x"))).rejects.toThrow(
      /Invalid storage key/,
    );
    await storage.stop();
  });
});

describe("the client lifecycle", () => {
  it("releases its sockets, because the port says it must", async () => {
    // ports/storage.ts: "Local disk owns nothing; an S3-compatible driver
    // holding its own HTTP client is not exempt." A keep-alive pool nobody
    // destroys is a process that does not exit.
    const storage = offline();
    await expect(storage.stop()).resolves.toBeUndefined();
    // Idempotent: a host calling close() twice on shutdown is ordinary.
    await expect(storage.stop()).resolves.toBeUndefined();
  });
});

describe.skipIf(!runnable)("a round trip against a real service", () => {
  const storage = new S3Storage({
    bucket: bucket as string,
    region: process.env.TEST_S3_REGION ?? "us-east-1",
    accessKeyId: accessKeyId as string,
    secretAccessKey: secretAccessKey as string,
    endpoint: endpoint as string,
    keyPrefix: `test-${randomUUID()}`,
  });

  afterAll(async () => {
    await storage.stop();
  });

  it("stores and reads the same bytes", async () => {
    const key = `ws_01/${randomUUID()}`;
    const body = Buffer.from("the bytes a check-in attachment holds");
    const stored = await storage.put(key, body, { contentType: "text/plain" });

    // The caller's key comes back, not the prefixed one: the prefix is the
    // driver's business and a caller that stored what it got back would double
    // it on the next read.
    expect(stored.key).toBe(key);
    expect(stored.size).toBe(body.byteLength);
    expect(await storage.get(key)).toEqual(body);

    await storage.delete(key);
  });

  it("answers a missing object with the port's own error", async () => {
    // The route above `readStoredFile` reads one answer, bytes or nothing, and
    // it can only do that if every driver raises the same type. A raw SDK error
    // here would reach a browser as a 500.
    await expect(storage.get(`ws_01/${randomUUID()}`)).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it("deletes an absent object without complaining", async () => {
    // The same no-op the local driver's `force` gives, so a cleanup job that
    // runs twice is not a failure.
    await expect(
      storage.delete(`ws_01/${randomUUID()}`),
    ).resolves.toBeUndefined();
  });

  it("signs a URL that expires", async () => {
    const key = `ws_01/${randomUUID()}`;
    await storage.put(key, Buffer.from("signed"));

    const url = await storage.signedUrl(key, 60);
    expect(url).toContain(bucket as string);
    // The expiry is in the signature, not only in the query string, so this
    // asserts the request was presigned rather than merely decorated.
    expect(url).toMatch(/X-Amz-Expires=60/);
    expect(url).toMatch(/X-Amz-Signature=/);

    const fetched = await fetch(url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer())).toEqual(
      Buffer.from("signed"),
    );

    await storage.delete(key);
  });

  it("keeps two instances in one bucket apart", async () => {
    // What `keyPrefix` is for. Two instances sharing a bucket must not be able
    // to read each other's blobs by guessing a workspace id.
    const other = new S3Storage({
      bucket: bucket as string,
      region: process.env.TEST_S3_REGION ?? "us-east-1",
      accessKeyId: accessKeyId as string,
      secretAccessKey: secretAccessKey as string,
      endpoint: endpoint as string,
      keyPrefix: `test-${randomUUID()}`,
    });
    const key = "ws_01/shared-name";
    await storage.put(key, Buffer.from("mine"));

    await expect(other.get(key)).rejects.toBeInstanceOf(ObjectNotFoundError);

    await storage.delete(key);
    await other.stop();
  });
});
