/**
 * Whether this instance is behind the newest GitHub release
 * (docs/design/version-footer.md §2).
 *
 * **A page never waits for GitHub.** `latest()` answers from memory at once.
 * When the answer is stale it starts one refresh in the background, and the
 * page that asked renders without the notice; the next one has it.
 *
 * **The request carries nothing about the instance**: no version, no name,
 * no identifier. The `User-Agent` is fixed, because GitHub's API refuses a
 * request without one.
 */

const RELEASES_URL =
  "https://api.github.com/repos/open-okr/open-okr/releases/latest";

const SUCCESS_LASTS_MS = 24 * 60 * 60 * 1000;
/** So an air-gapped instance with the check left on tries once an hour. */
const FAILURE_LASTS_MS = 60 * 60 * 1000;

export interface LatestRelease {
  /** Without the leading `v`. */
  readonly version: string;
  readonly url: string;
}

type Version = readonly [number, number, number];

/** Major, minor and patch. A pre-release or build suffix is dropped. */
function parseVersion(text: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(text.trim());
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isBehind(running: string, latest: string): boolean {
  const a = parseVersion(running);
  const b = parseVersion(latest);
  if (a === null || b === null) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) {
      return left < right;
    }
  }
  return false;
}

const TAG = /^v?\d+\.\d+\.\d+$/;

export function parseRelease(body: string): LatestRelease | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (json === null || typeof json !== "object") {
    return null;
  }
  const { tag_name: tag, html_url: url } = json as Record<string, unknown>;
  if (typeof tag !== "string" || !TAG.test(tag)) {
    return null;
  }
  // Only GitHub's own pages: the address becomes a link on every admin's
  // screen, so a payload cannot point it anywhere else.
  if (typeof url !== "string" || !url.startsWith("https://github.com/")) {
    return null;
  }
  return { version: tag.replace(/^v/, ""), url };
}

/** What the checker needs from the outside: the port's fetch and a clock. */
export interface UpdateCheckDeps {
  readonly fetch: (
    url: string,
    options: {
      readonly timeoutMs: number;
      readonly maxBytes: number;
      readonly headers: Readonly<Record<string, string>>;
    },
  ) => Promise<
    { readonly ok: true; readonly body: string } | { readonly ok: false }
  >;
  readonly now: () => number;
}

export function createUpdateChecker(deps: UpdateCheckDeps) {
  let release: LatestRelease | null = null;
  let validUntil = 0;
  let inFlight: Promise<void> | null = null;

  const refresh = async (): Promise<void> => {
    let found: LatestRelease | null = null;
    try {
      const answer = await deps.fetch(RELEASES_URL, {
        timeoutMs: 3_000,
        maxBytes: 64 * 1024,
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "OpenOKR-update-check",
        },
      });
      found = answer.ok ? parseRelease(answer.body) : null;
    } catch {
      found = null;
    }
    if (found) {
      release = found;
      validUntil = deps.now() + SUCCESS_LASTS_MS;
    } else {
      // The last good answer is kept: a release does not stop existing
      // because GitHub did not answer this hour.
      validUntil = deps.now() + FAILURE_LASTS_MS;
    }
  };

  return {
    /** The newest release known now. Never waits. */
    latest(): LatestRelease | null {
      if (deps.now() >= validUntil && inFlight === null) {
        inFlight = refresh().finally(() => {
          inFlight = null;
        });
      }
      return release;
    },
    /** Resolves when a refresh in progress has finished. For tests. */
    async settled(): Promise<void> {
      await inFlight;
    },
  };
}
