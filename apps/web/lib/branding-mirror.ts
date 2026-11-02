/**
 * What the Branding page's live mirror draws (docs/design/branding-page.md
 * §3): what is in force, with anything chosen and not yet saved laid over it.
 */

export interface SavedBranding {
  /** The colour as stored, or null for the product's own. */
  readonly stored: string | null;
  /** The fill the layout applies, which is darker when the stored one was too light. */
  readonly fill: string | null;
  readonly logoUrl: string | null;
  readonly faviconUrl: string | null;
}

export interface PendingBranding {
  /** A whole, accepted colour in the field, or null/absent for none. */
  readonly colour?: string | null;
  /** An object URL of a chosen, unsaved image. */
  readonly logoUrl?: string | null;
  readonly faviconUrl?: string | null;
}

type UnsavedPart = "colour" | "logo" | "favicon";

export interface Mirror {
  /** The brand fill to draw, or null for the product's own. */
  readonly brand: string | null;
  readonly logoUrl: string | null;
  readonly faviconUrl: string | null;
  readonly unsaved: readonly UnsavedPart[];
}

export function mirrorOf(
  saved: SavedBranding,
  pending: PendingBranding,
): Mirror {
  const typed = pending.colour ?? null;
  const colourPending = typed !== null && typed !== saved.stored;
  const unsaved: UnsavedPart[] = [];
  if (colourPending) {
    unsaved.push("colour");
  }
  if (pending.logoUrl) {
    unsaved.push("logo");
  }
  if (pending.faviconUrl) {
    unsaved.push("favicon");
  }
  return {
    // An unsaved colour is drawn as typed: the darkening the layout applies
    // happens on save, and the field's sentence says when it will.
    brand: colourPending ? typed : saved.fill,
    logoUrl: pending.logoUrl ?? saved.logoUrl,
    faviconUrl: pending.faviconUrl ?? saved.faviconUrl,
    unsaved,
  };
}
