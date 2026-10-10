/**
 * The characters a terminal login code is drawn from.
 *
 * No 0 or O and no 1, I or L, so a code read off one screen and typed into
 * another cannot be mistyped. The field drops them as they are typed for the
 * same reason, and upper-cases the rest, which the server does before it
 * looks a code up.
 */
export const DEVICE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * The short code a person sees and may type: two groups of four, written
 * with a hyphen between them, `ABCD-EFGH`.
 */
export const DEVICE_USER_CODE_GROUPS = [4, 4] as const;

/** The groups of a typed code joined the way the code was issued. */
export function formatDeviceUserCode(characters: string): string {
  const parts: string[] = [];
  let start = 0;
  for (const size of DEVICE_USER_CODE_GROUPS) {
    parts.push(characters.slice(start, start + size));
    start += size;
  }
  return parts.join("-");
}
