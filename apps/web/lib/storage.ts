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
 * its files across an upgrade with nothing configured. An S3-compatible driver
 * behind the same port is an alternative for a deployment that wants one.
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
import { LocalDiskStorage, ObjectNotFoundError } from "@openokr/adapters";
import { loadEnv } from "@openokr/config";

const globals = globalThis as typeof globalThis & {
  openokrStorage?: FileStorage;
};

export function getStorage(): FileStorage {
  if (!globals.openokrStorage) {
    const env = loadEnv();
    globals.openokrStorage = new LocalDiskStorage({
      root: env.OPENOKR_STORAGE_ROOT,
      signingSecret: env.BETTER_AUTH_SECRET,
    });
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
