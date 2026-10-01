/**
 * Moving a card with the keyboard, as arithmetic (UIUX-PLAN §9, completeness
 * review M-02).
 *
 * The board follows the pattern the WAI-ARIA practices describe for a sortable
 * list: a card is picked up, moved with the arrow keys, and dropped or put
 * back. While it is held, every step is local and nothing is written; the drop
 * is one `tasks.move`, the same write a drag makes, so the ordering it relies
 * on stays the server's alone. These functions are the local half: where a key
 * sends a held card, and which card it then sits after.
 *
 * Pure and framework-free, so they are tested without a browser.
 */

export interface KeyCard {
  readonly id: string;
  readonly status: string;
}

export interface KeyColumn<TCard extends KeyCard> {
  readonly status: string;
  readonly cards: readonly TCard[];
}

/** Where a card sits: its column, and its place counted from the top. */
export interface Slot {
  readonly status: string;
  /** From zero. */
  readonly index: number;
  /** How many cards the column holds, this one included. */
  readonly count: number;
}

export type MoveKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

const MOVE_KEYS: readonly string[] = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
];

export function isMoveKey(key: string): key is MoveKey {
  return MOVE_KEYS.includes(key);
}

/** Where a card is, or null when it is on no column. */
export function slotOf<TCard extends KeyCard>(
  columns: readonly KeyColumn<TCard>[],
  id: string,
): Slot | null {
  for (const column of columns) {
    const index = column.cards.findIndex((card) => card.id === id);
    if (index !== -1) {
      return { status: column.status, index, count: column.cards.length };
    }
  }
  return null;
}

/**
 * Where one key sends a held card, or null when it is already as far as it
 * can go that way.
 *
 * Up and down move within the column. Left and right move to the next column
 * in the board's own order and keep the card at the same height, or at the
 * bottom of a shorter column, which is where a person carrying it sideways
 * would expect it to land.
 */
export function stepTarget<TCard extends KeyCard>(
  columns: readonly KeyColumn<TCard>[],
  id: string,
  key: MoveKey,
): { readonly status: string; readonly index: number } | null {
  const here = slotOf(columns, id);
  if (!here) {
    return null;
  }
  if (key === "ArrowUp") {
    return here.index > 0
      ? { status: here.status, index: here.index - 1 }
      : null;
  }
  if (key === "ArrowDown") {
    return here.index < here.count - 1
      ? { status: here.status, index: here.index + 1 }
      : null;
  }
  const at = columns.findIndex((column) => column.status === here.status);
  const next = columns[at + (key === "ArrowRight" ? 1 : -1)];
  if (!next) {
    return null;
  }
  return {
    status: next.status,
    index: Math.min(here.index, next.cards.length),
  };
}

/**
 * The board with one card taken out and put back at a column and a place.
 *
 * The place is clamped to the column, so a board that changed under a held
 * card (somebody else moved one) still has somewhere to put it. Null when the
 * card is not on the board at all, which is a card somebody deleted.
 */
export function placeAt<TCard extends KeyCard>(
  columns: readonly KeyColumn<TCard>[],
  id: string,
  status: string,
  index: number,
): KeyColumn<TCard>[] | null {
  const moving = columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === id);
  if (!moving) {
    return null;
  }
  return columns.map((column) => {
    const without = column.cards.filter((card) => card.id !== id);
    if (column.status !== status) {
      return { ...column, cards: without };
    }
    const cards = [...without];
    cards.splice(Math.max(0, Math.min(index, cards.length)), 0, {
      ...moving,
      status,
    });
    return { ...column, cards };
  });
}

/**
 * The card a held card now sits after, which is what `tasks.move` is told.
 *
 * Null at the top of its column. The browser names a neighbour and never a
 * position, for the reason the board states: the order has exactly one owner.
 */
export function afterTaskIdOf<TCard extends KeyCard>(
  columns: readonly KeyColumn<TCard>[],
  id: string,
): string | null {
  const here = slotOf(columns, id);
  if (!here || here.index === 0) {
    return null;
  }
  const column = columns.find((one) => one.status === here.status);
  return column?.cards[here.index - 1]?.id ?? null;
}
