/**
 * What a branding save hands back (completeness review M-14).
 *
 * Its own module because `actions.ts` is a `"use server"` file and those may
 * export only async functions, the same split the rhythm card makes.
 */
export interface BrandingState {
  /** Why the colour was refused, in words the administrator can act on. */
  readonly error: string | null;
  /** The confirmation. Empty before a save. */
  readonly saved: string | null;
}

export const NOTHING_SAVED: BrandingState = { error: null, saved: null };

/**
 * Why each status family is refused, one whole sentence per family. Shared
 * by the field, which says it as the colour is picked, and the action, which
 * says it again for a request that did not come from the field.
 */
export const REFUSED_HUE = {
  red: "admin.branding.brandingSettingsForm.refusedRed",
  amber: "admin.branding.brandingSettingsForm.refusedAmber",
  green: "admin.branding.brandingSettingsForm.refusedGreen",
} as const;
