import {
  NAVIGATION_GROUPS,
  type NavigationGroup,
  type NavigationItem,
} from "@openokr/core";
import type { TerminologyOverrides, TermKey } from "@openokr/method";

/**
 * The heading each sidebar block wears (UIUX-PLAN.md §3).
 *
 * `primary` has none on purpose: Home, Review and Inbox are the top of the
 * list and a heading above the first three rows only adds noise. The mockup
 * `01-work-map` draws it the same way, "PRACTICE" and "SPACES" being the only
 * two `.navsec` labels in the panel.
 *
 * `account` is not in §3's own list of blocks. Its two items ("Where to reach
 * you", "Security") are in the registry's sidebar section today and also in
 * the avatar menu, so they are labelled rather than silently mixed into
 * Practice. Whether they belong in the sidebar at all is a separate question
 * from whether the blocks are labelled, and is not decided here.
 */
const LABELS: Readonly<Record<NavigationGroup, string | undefined>> = {
  primary: undefined,
  // OKR and Work since P9-T07a-b (okr-entry-points.md §3.1, decision D5):
  // the practice's own objects in one block, the work that serves them in
  // the next, where "Practice" had held both and three screens besides.
  okr: "OKR",
  work: "Work",
  spaces: "Spaces",
  account: "Account",
};

export interface NavBlock {
  readonly id: NavigationGroup;
  readonly label?: string;
  readonly items: readonly NavigationItem[];
}

/**
 * The sidebar entries named after one of the method's terms, and in which
 * number (completeness review M-14).
 *
 * A workspace that calls a space a team expects the sidebar to say Teams. Only
 * a rename replaces the registry's label: the sidebar's labels are the
 * registry's English, and filling these three from the catalogue for a reader
 * in Bahasa Melayu would translate three entries of fifteen.
 */
const TERM_ITEMS: Readonly<
  Record<string, readonly [TermKey, "singular" | "plural"]>
> = {
  cycle: ["cycle", "singular"],
  kpis: ["kpi", "plural"],
  spaces: ["space", "plural"],
};

/** Raised first letter, because a sidebar entry reads as a heading does. */
const asHeading = (label: string) =>
  label.charAt(0).toUpperCase() + label.slice(1);

/** An item's sidebar label, in the workspace's own word when it has one. */
export function navLabel(
  item: Pick<NavigationItem, "id" | "label">,
  renamed: TerminologyOverrides = {},
): string {
  const term = TERM_ITEMS[item.id];
  const label = term ? renamed[term[0]]?.[term[1]] : undefined;
  return label === undefined ? item.label : asHeading(label);
}

/**
 * Splits a flat item list into §3's blocks, in `NAVIGATION_GROUPS` order.
 *
 * Empty blocks are dropped rather than rendered as a heading with nothing
 * under it, which is what would happen every time a block's only module is
 * above the reader's access level.
 *
 * An item with no `group` falls into `primary`. The registry's own test
 * asserts no sidebar item is in that state, so this is a floor rather than a
 * behaviour anything relies on.
 */
export function navBlocks(
  items: readonly NavigationItem[],
  renamed: TerminologyOverrides = {},
): readonly NavBlock[] {
  return NAVIGATION_GROUPS.map((id) => {
    // The Spaces block is headed by the term, so it follows a rename the way
    // the Spaces entry does (M-14).
    const plural = id === "spaces" ? renamed.space?.plural : undefined;
    const label = plural === undefined ? LABELS[id] : asHeading(plural);
    return {
      id,
      ...(label === undefined ? {} : { label }),
      items: items.filter((item) => (item.group ?? "primary") === id),
    };
  }).filter((block) => block.items.length > 0);
}
