"use server";

/**
 * The one place this preview page touches `@openokr/core` at all.
 *
 * `page.tsx` is a Client Component (it needs `useState` for the live
 * demo), and `@openokr/core`'s index is one barrel re-exporting
 * everything the package has, including server-only Postgres/Drizzle
 * code (`workspaces/memberships.ts` and onward) that imports Node
 * built-ins (`net`, `tls`, `util/types`) with no browser equivalent.
 * Importing *anything* from that barrel inside a Client Component pulls
 * the whole graph into the browser bundle — not a tree-shaking gap, a
 * hard build failure (`Module not found: Can't resolve 'net'`).
 *
 * A Server Action is the fix, not a narrower import path: it keeps every
 * byte of `@openokr/core` server-side by construction, the same
 * client/server split `packages/ui`'s own `validate` prop was already
 * designed around (docs/design/rich-text-editor.md §9) — this is that
 * prop's real host finally exercising it for real, rather than calling
 * the validator directly and in-process the way a synchronous prop might
 * suggest.
 */
import { isValidRichText, RICH_TEXT_SCHEMA_VERSION } from "@openokr/core";

export async function validateRichTextPreview(json: unknown): Promise<boolean> {
  return isValidRichText(json, RICH_TEXT_SCHEMA_VERSION);
}
