/**
 * The S3-compatible storage driver (P6-G05).
 *
 * **Why this exists.** PLAN.md and the Helm chart have offered S3-compatible
 * object storage as the way to run more than one replica since P1-T09, and no
 * driver existed: `packages/adapters/src/drivers/storage/` held local disk and
 * nothing else. The chart's own refusal message told an operator to point
 * storage at S3 and leave persistence disabled, which was advice nobody could
 * follow. The gap audit of 7 September 2026 recorded it as B-11; P6-G04
 * removed the false advice and this puts it back true.
 *
 * **Local disk stays the default.** A self-hosted install needs no object
 * store, and Postgres remains the only required service. This driver is chosen
 * only when a bucket is named.
 *
 * **Any compatible service, not only AWS.** `endpoint` plus path-style
 * addressing is what makes MinIO, Ceph, Garage, Backblaze B2, Cloudflare R2 and
 * DigitalOcean Spaces work through the same code. Virtual-host addressing is
 * the default when no endpoint is given, because that is what AWS itself wants.
 *
 * **The same keys behave the same way on both drivers.** A key is
 * caller-supplied and may carry a filename that came from a browser. On disk
 * that means traversal out of the root; on S3 `..` is just a literal segment
 * and harmless, which is exactly why the check belongs here too: a key that one
 * driver refuses and the other accepts is a difference that only shows up after
 * somebody migrates.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  type FileStorage,
  ObjectNotFoundError,
  type PutOptions,
  type StoredObject,
} from "../../ports/storage.ts";

export interface S3StorageOptions {
  readonly bucket: string;
  /** Required by the SDK even for services that ignore it. */
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /**
   * A compatible service's own endpoint. Absent means AWS S3 itself, addressed
   * virtual-host style.
   */
  readonly endpoint?: string;
  /**
   * Path-style addressing (`https://host/bucket/key`). Defaults to true when an
   * endpoint is given, because almost every compatible service wants it and a
   * virtual-host request to one resolves to a hostname that does not exist.
   */
  readonly forcePathStyle?: boolean;
  /** Prefix every key with this, so one bucket can hold several instances. */
  readonly keyPrefix?: string;
  readonly defaultExpirySeconds?: number;
}

const DEFAULT_EXPIRY_SECONDS = 300;

/**
 * Refuses the key shapes the local-disk driver refuses.
 *
 * Deliberately not a normalisation. A caller that built a key out of a browser
 * filename has a defect, and silently rewriting it hides that on one driver and
 * not the other.
 */
export function refuseUnsafeKey(key: string): void {
  const bad =
    key === "" ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((segment) => segment === ".." || segment === ".");
  if (bad) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

export class S3Storage implements FileStorage {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #prefix: string;
  readonly #defaultExpiry: number;

  constructor(options: S3StorageOptions) {
    this.#bucket = options.bucket;
    this.#prefix = options.keyPrefix
      ? `${trimSlashes(options.keyPrefix)}/`
      : "";
    this.#defaultExpiry =
      options.defaultExpirySeconds ?? DEFAULT_EXPIRY_SECONDS;
    this.#client = new S3Client({
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle ?? options.endpoint !== undefined,
    });
  }

  /** The object key this driver actually uses, prefix included. */
  #objectKey(key: string): string {
    refuseUnsafeKey(key);
    return `${this.#prefix}${key}`;
  }

  async put(
    key: string,
    body: Buffer,
    options?: PutOptions,
  ): Promise<StoredObject> {
    const contentType = options?.contentType ?? "application/octet-stream";
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: this.#objectKey(key),
        Body: body,
        ContentType: contentType,
      }),
    );
    // The caller's key, not the prefixed one: the prefix is this driver's
    // business and a caller that stored what it got back would double it.
    return { key, size: body.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: this.#objectKey(key),
        }),
      );
      const body = response.Body;
      if (!body) {
        throw new ObjectNotFoundError(key);
      }
      return Buffer.from(await body.transformToByteArray());
    } catch (error) {
      // `NoSuchKey` is the typed one. A service that answers 404 without the
      // discriminator is caught by the name, which is what several
      // S3-compatible implementations actually return.
      if (
        error instanceof NoSuchKey ||
        (error as { name?: string }).name === "NoSuchKey" ||
        (error as { name?: string }).name === "NotFound"
      ) {
        throw new ObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 answers a delete of an absent object with success, which is the same
    // no-op the local driver's `force` gives, so retries and cleanup jobs stay
    // simple on both.
    await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#bucket,
        Key: this.#objectKey(key),
      }),
    );
  }

  async signedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    return getSignedUrl(
      this.#client,
      new GetObjectCommand({
        Bucket: this.#bucket,
        Key: this.#objectKey(key),
      }),
      { expiresIn: expiresInSeconds ?? this.#defaultExpiry },
    );
  }

  async stop(): Promise<void> {
    // The port's own comment names this driver: "an S3-compatible driver
    // holding its own HTTP client is not exempt". The client keeps sockets in a
    // keep-alive pool and a process that never destroys it does not exit.
    this.#client.destroy();
  }
}

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, "");
