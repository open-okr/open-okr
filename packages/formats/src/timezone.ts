/**
 * Is this a timezone the runtime actually knows?
 *
 * The value arrives from the browser, so it is untrusted input reaching a
 * stored field. Asking `Intl` is the only honest check: a hand-written list
 * would rot, and a regular expression would accept plausible nonsense.
 *
 * In the browser this asks the browser's runtime, which can disagree with the
 * server's on a few legacy names. The server's answer is the one that counts.
 */
export function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

let listed: readonly string[] | null = null;
let listedSet: ReadonlySet<string> | null = null;

/**
 * Every timezone a person may choose (docs/design/guided-inputs.md §4.6):
 * the runtime's own list, with `UTC` first because the runtime leaves it out.
 *
 * **Asked of the server, and handed to the browser.** Runtimes disagree on a
 * few legacy names, `Asia/Calcutta` against `Asia/Kolkata`, so a list the
 * browser made could offer a name the server refuses. The server's list is
 * the one a screen offers and the one a write is checked against.
 */
export function listTimezones(): readonly string[] {
  if (listed === null) {
    const zones = Intl.supportedValuesOf("timeZone").filter(
      (zone) => zone !== "UTC",
    );
    listed = ["UTC", ...zones];
    listedSet = new Set(listed);
  }
  return listed;
}

/**
 * Whether `name` is on the list, exactly as written. `isKnownTimezone` takes
 * anything the runtime can resolve, including `EST`, `+08:00` and a name in
 * the wrong case, which is why a write is checked against this instead.
 */
export function isListedTimezone(name: string): boolean {
  listTimezones();
  return listedSet?.has(name) ?? false;
}

/**
 * The cookie a browser writes its own timezone into, and the server reads when
 * it makes a workspace or a member (docs/design/browser-timezone.md). Named
 * here, once, because the component that writes it runs in the browser and
 * the hook that reads it runs on the server.
 */
export const BROWSER_TIMEZONE_COOKIE = "openokr_tz";

const resolveZone = (zone: string): string | null => {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
};

/**
 * A zone a browser reports, as the name on the list, or null.
 *
 * A listed name comes back as it is. Otherwise the runtime is asked what the
 * name resolves to, and the listed name resolving to the same zone is
 * returned: a browser may say `Asia/Calcutta` where the server lists
 * `Asia/Kolkata`. Anything else, `+08:00` and a name nobody has heard of
 * among them, matches nothing. The picker's "use this device's zone" and the
 * default a workspace is born with both ask this, so they cannot disagree.
 */
export function matchListedTimezone(
  zone: string,
  zones: readonly string[] = listTimezones(),
): string | null {
  if (zone === "") {
    return null;
  }
  if (zones.includes(zone)) {
    return zone;
  }
  const target = resolveZone(zone);
  if (target === null) {
    return null;
  }
  return zones.find((listed) => resolveZone(listed) === target) ?? null;
}
