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
