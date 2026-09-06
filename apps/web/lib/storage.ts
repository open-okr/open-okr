/**
 * Process-wide file storage (TECHNICAL-PLAN §5, P5-T15).
 *
 * **The first thing in this product to hold a file.** The `FileStorage` port
 * and its local-disk driver have been in `packages/adapters` since P2-T05, and
 * nothing ever constructed one, in the same way nothing constructed the outbox
 * relay until P5-T01a. A large export is the first write with bytes behind it,
 * so this is where the driver is finally built.
 *
 * **Local disk is the default and the only thing a self-hosted install needs.**
 * `OPENOKR_STORAGE_ROOT` is `storage` unless somebody says otherwise, which is
 * where the compose file already mounts a named volume, so a container keeps
 * its files across an upgrade with nothing configured. Postgres stays the only
 * required service.
 *
 * **Naming `OPENOKR_STORAGE_S3_BUCKET` switches to the S3-compatible driver**
 * (P6-G05), which is what a deployment with more than one replica needs: a
 * local-disk volume cannot be shared across nodes, and the Helm chart has said
 * so since P1-T09 while offering a driver that did not exist until now.
 *
 * **The signing secret is the instance's own, and nothing signs today.** Files
 * reach a browser through `/api/exports/[id]/download`, which authorises the
 * caller first: an export holds exactly one member's access-filtered rows, so a
 * URL that anybody holding it could redeem would be wider than the file. The
 * driver still requires a secret for the signed-URL path it also offers, and
 * deriving it from `BETTER_AUTH_SECRET` means there is nothing new to
 * configure before the product works.
 *
 * Cached on `globalThis` for the reason `getPool()` and `getRealtime()` are:
 * Next.js reloads modules in development and would otherwise build a driver per
 * reload.
 */
import type { FileStorage } from "@openokr/adapters";
import {
  LocalDiskStorage,
  ObjectNotFoundError,
  S3Storage,
} from "@openokr/adapters";
import { type Env, loadEnv } from "@openokr/config";

const globals = globalThis as typeof globalThis & {
  openokrStorage?: FileStorage;
};

/**
 * Which driver an environment asks for (P6-G05).
 *
 * Naming a bucket is the whole switch. Exported and pure so a test can assert
 * the choice without building a client, the way `resolveMailSettings` is: the
 * decision is one line and the failure mode of getting it wrong is an instance
 * that quietly writes to the wrong place.
 *
 * The environment schema already refused a bucket with no credentials at boot,
 * so by the time this runs a named bucket has both.
 */
export function storageDriverFor(env: Env): FileStorage {
  if (env.OPENOKR_STORAGE_S3_BUCKET === undefined) {
    return new LocalDiskStorage({
      root: env.OPENOKR_STORAGE_ROOT,
      signingSecret: env.BETTER_AUTH_SECRET,
    });
  }
  return new S3Storage({
    bucket: env.OPENOKR_STORAGE_S3_BUCKET,
    region: env.OPENOKR_STORAGE_S3_REGION,
    accessKeyId: env.OPENOKR_STORAGE_S3_ACCESS_KEY_ID as string,
    secretAccessKey: env.OPENOKR_STORAGE_S3_SECRET_ACCESS_KEY as string,
    ...(env.OPENOKR_STORAGE_S3_ENDPOINT
      ? { endpoint: env.OPENOKR_STORAGE_S3_ENDPOINT }
      : {}),
    ...(env.OPENOKR_STORAGE_S3_FORCE_PATH_STYLE
      ? { forcePathStyle: env.OPENOKR_STORAGE_S3_FORCE_PATH_STYLE === "on" }
      : {}),
    ...(env.OPENOKR_STORAGE_S3_KEY_PREFIX
      ? { keyPrefix: env.OPENOKR_STORAGE_S3_KEY_PREFIX }
      : {}),
  });
}

/** Names the storage in use, for the first-run wizard and the boot log. */
export function storageDescription(env: Env = loadEnv()): string {
  if (env.OPENOKR_STORAGE_S3_BUCKET === undefined) {
    return `local disk at ${env.OPENOKR_STORAGE_ROOT}`;
  }
  const where = env.OPENOKR_STORAGE_S3_ENDPOINT ?? "AWS S3";
  return `S3-compatible bucket ${env.OPENOKR_STORAGE_S3_BUCKET} at ${where}`;
}

export function getStorage(): FileStorage {
  if (!globals.openokrStorage) {
    globals.openokrStorage = storageDriverFor(loadEnv());
  }
  return globals.openokrStorage;
}

/**
 * One stored file, or null when the bytes are gone.
 *
 * Here rather than in the route, so the driver's own error type stays on this
 * side of the port and the route reads one answer: bytes, or nothing.
 *
 * Null rather than a thrown error: a run that says ready with no file behind it
 * happens when a volume was replaced, and there is nothing to hand over.
 */
export async function readStoredFile(key: string): Promise<Buffer | null> {
  try {
    return await getStorage().get(key);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return null;
    }
    throw error;
  }
}
