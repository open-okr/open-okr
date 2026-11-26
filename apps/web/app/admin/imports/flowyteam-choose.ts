/**
 * The Choose step's pure helpers (flowyteam-connect C6). Kept apart from
 * flowyteam-view.ts because the card is a client component and the view
 * imports @openokr/core, which must never reach the browser bundle.
 */

/** A domain as the card knows it: its key and the keys it needs first. */
export interface DomainChoice {
  readonly key: string;
  readonly requires: readonly string[];
}

/**
 * Ticks or unticks one domain with its neighbours kept consistent: ticking
 * adds everything it needs (transitively), unticking removes everything that
 * needs it (transitively). The engine would add a prerequisite anyway, so the
 * card shows the choice that will really run.
 */
export function toggleDomain(
  domains: readonly DomainChoice[],
  chosen: ReadonlySet<string>,
  key: string,
  on: boolean,
): Set<string> {
  const next = new Set(chosen);
  const byKey = new Map(domains.map((domain) => [domain.key, domain]));
  if (on) {
    const walk = (current: string) => {
      next.add(current);
      for (const need of byKey.get(current)?.requires ?? []) {
        if (!next.has(need)) walk(need);
      }
    };
    walk(key);
    return next;
  }
  const drop = (current: string) => {
    next.delete(current);
    for (const domain of domains) {
      if (domain.requires.includes(current) && next.has(domain.key)) {
        drop(domain.key);
      }
    }
  };
  drop(key);
  return next;
}

/**
 * The `only` list to send for these keys: undefined when they cover every
 * domain (or name none the card knows), so a full run stays the default run.
 * In the card's dependency order.
 */
export function onlyOf(
  domains: readonly DomainChoice[],
  keys: Iterable<string>,
): string[] | undefined {
  const wanted = new Set(keys);
  const picked = domains
    .map((domain) => domain.key)
    .filter((key) => wanted.has(key));
  return picked.length === 0 || picked.length === domains.length
    ? undefined
    : picked;
}
