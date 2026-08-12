/**
 * The FileStorage port (TECHNICAL-PLAN §5).
 *
 * Keys are opaque paths chosen by the caller, always workspace-prefixed by
 * the calling service so one workspace's blobs cannot collide with another's.
 * Signed URLs expire; they are the only way a blob reaches a browser.
 */

export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
}

export interface PutOptions {
  readonly contentType?: string;
}

export interface FileStorage {
  put(key: string, body: Buffer, options?: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  /** A time-limited URL. `expiresInSeconds` defaults to the driver's own default. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
  /** Releases whatever this driver holds open. Local disk owns nothing; an
   * S3-compatible driver holding its own HTTP client is not exempt. */
  stop(): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  override readonly name = "ObjectNotFoundError";
  constructor(key: string) {
    super(`No stored object for key: ${key}`);
  }
}
