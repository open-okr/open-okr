/** One DNS label: letters, digits and inner hyphens, 63 at most. */
const isHostLabel = (label: string): boolean =>
  /^[a-z0-9-]{1,63}$/.test(label) &&
  !label.startsWith("-") &&
  !label.endsWith("-");

/**
 * A host an AI call may reach: a name, or an address written as one
 * (moved here from the settings registry, so the egress list's field checks
 * each host with the server's own rule, guided-inputs §4.11).
 *
 * Checked label by label rather than with one pattern over the whole name,
 * which is the shape a backtracking engine takes polynomial time over. An
 * IPv6 address is accepted as its own characters, without brackets.
 */
export function isHostName(value: string): boolean {
  if (value.length === 0 || value.length > 253) {
    return false;
  }
  if (value.includes(":")) {
    return /^[0-9a-f:.]{2,45}$/.test(value);
  }
  return value.split(".").every(isHostLabel);
}

/**
 * A host as somebody gives it: a pasted address is reduced to its host,
 * since that is what the egress guard compares and what the person meant.
 * Anything that is not an address is handed back as it is, lower-cased, for
 * `isHostName` to judge.
 */
export function hostOf(entry: string): string {
  const trimmed = entry.trim();
  if (!trimmed.includes("://")) {
    return trimmed.toLowerCase();
  }
  try {
    return new URL(trimmed).hostname;
  } catch {
    return trimmed.toLowerCase();
  }
}
