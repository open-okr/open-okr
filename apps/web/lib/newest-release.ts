import { outboundFetch } from "@openokr/adapters";
import { readUpdateCheck } from "@openokr/core";
import { RUNNING_VERSION } from "./app-version.ts";
import {
  createUpdateChecker,
  isBehind,
  type LatestRelease,
} from "./update-check.ts";

/**
 * Whether the update check is on, and the newer release when this instance is
 * behind one (docs/design/version-footer.md §2).
 *
 * **One checker per process**, shared by the footer and the operator console
 * (plan 0.8.0 V2), so the cache is shared by every request and the two never
 * make two requests a day between them.
 */
const checker = createUpdateChecker({
  fetch: (url, options) => outboundFetch(url, options),
  now: () => Date.now(),
});

export interface ReleaseCheck {
  readonly enabled: boolean;
  /** Null when the check is off, not answered yet, or nothing is newer. */
  readonly newer: LatestRelease | null;
}

export async function releaseCheck(
  pool: Parameters<typeof readUpdateCheck>[0],
): Promise<ReleaseCheck> {
  // A read that fails is treated as off, which sends nothing.
  const enabled =
    (await readUpdateCheck(pool).catch(() => null))?.value === true;
  if (!enabled) {
    return { enabled, newer: null };
  }
  const latest = checker.latest();
  return {
    enabled,
    newer: latest && isBehind(RUNNING_VERSION, latest.version) ? latest : null,
  };
}
