/**
 * Trimming a base URL, in the one place everything that needs it can reach.
 *
 * **A module with no imports, on purpose.** Every caller here is a leaf of a
 * different subtree: OAuth discovery, the consent check, the device login and
 * the outbox's email handlers. Importing nothing means none of them can pull a
 * cycle in through this file, which is the same reason `ai/assist-keys.ts`
 * imports nothing.
 */

/**
 * A base URL with its trailing slashes removed, without a regular expression.
 *
 * **The regular expression is the reason this function exists.** It was written
 * four separate times as an anchored `/\/+$/` replace, and CodeQL classifies
 * that as a polynomial denial of service: a `+` anchored to the end is retried
 * from every position, so the work is quadratic in the number of slashes and a
 * URL made of them alone stalls the request that carries it. Two copies were
 * already rewritten as this loop, in `api/device.ts` and `outbox/handlers.ts`,
 * and the pattern came back in the OAuth code because there was nowhere to
 * import it from. Now there is.
 *
 * The loop is linear, and 47 is the character code for `/`.
 */
export function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
}
