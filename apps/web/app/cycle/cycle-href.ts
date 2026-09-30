/**
 * Addresses inside the cycle workspace that stay on the cycle being read
 * (completeness review M-06).
 *
 * `/cycle` with no cycle named opens this quarter. Every link inside the screen
 * was written that way, so opening the annual cycle and pressing phase 4 in the
 * rail landed back in the quarter, and the annual cycle could be looked at but
 * not worked in. A cycle the reader chose travels with every link; the quarter
 * keeps its short address, which is what every other screen links to.
 */

/** One phase of the cycle being read. */
export function phaseHref(phase: number, pinnedCycleId: string | null): string {
  return pinnedCycleId
    ? `/cycle?cycle=${pinnedCycleId}&phase=${phase}`
    : `/cycle?phase=${phase}`;
}

/**
 * A remedy link, kept on the cycle being read when it points into this screen.
 * Anything else (another screen, an anchor on this page) is left as it is.
 */
export function keepCycle(href: string, pinnedCycleId: string | null): string {
  const prefix = "/cycle?";
  if (!pinnedCycleId || !href.startsWith(prefix)) {
    return href;
  }
  return `/cycle?cycle=${pinnedCycleId}&${href.slice(prefix.length)}`;
}
