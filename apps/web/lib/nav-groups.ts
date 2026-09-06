import {
  NAVIGATION_GROUPS,
  type NavigationGroup,
  type NavigationItem,
} from "@openokr/core";

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
  practice: "Practice",
  spaces: "Spaces",
  account: "Account",
};

export interface NavBlock {
  readonly id: NavigationGroup;
  readonly label?: string;
  readonly items: readonly NavigationItem[];
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
): readonly NavBlock[] {
  return NAVIGATION_GROUPS.map((id) => {
    const label = LABELS[id];
    return {
      id,
      ...(label === undefined ? {} : { label }),
      items: items.filter((item) => (item.group ?? "primary") === id),
    };
  }).filter((block) => block.items.length > 0);
}
