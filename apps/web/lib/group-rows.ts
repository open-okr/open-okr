/**
 * Rows grouped under a heading, in the order each heading first appears.
 *
 * For lists that printed a key result beside its objective's name on every
 * line, or every session with its space after it (usability review C6, C7):
 * grouped, the name is said once and the rows under it are the ones that
 * belong to it. The caller's order is kept inside each group.
 */
export function groupRows<T>(
  rows: readonly T[],
  heading: (row: T) => string,
): { readonly heading: string; readonly rows: readonly T[] }[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = heading(row);
    const held = groups.get(key);
    if (held) {
      held.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  return [...groups.entries()].map(([key, held]) => ({
    heading: key,
    rows: held,
  }));
}
