/**
 * Draft autosave (docs/design/rich-text-editor.md §8). Pure logic —
 * `localStorage` reads/writes live in `use-draft-autosave.ts`, so this
 * file is plain, synchronous and directly testable.
 */

export interface DraftRecord {
  readonly content: unknown;
  readonly baseFingerprint: string;
  readonly savedAt: number;
  readonly expiresAt: number;
}

const DEFAULT_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

export function draftStorageKey(
  entityType: string,
  entityId: string,
  memberId: string,
): string {
  return `openokr:draft:${entityType}:${entityId}:${memberId}`;
}

/**
 * A cheap rolling hash, not a cryptographic digest — this only has to
 * detect "did the base content change," never resist tampering (the same
 * reasoning `avatarToneFor`, P2-T10, already applies to a different
 * problem). Stringifying first means two structurally-identical
 * documents fingerprint identically regardless of object identity.
 */
export function fingerprint(content: unknown): string {
  const text = JSON.stringify(content) ?? "";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export function createDraft(
  content: unknown,
  baseContent: unknown,
  now: number,
  expiryMs = DEFAULT_EXPIRY_MS,
): DraftRecord {
  return {
    content,
    baseFingerprint: fingerprint(baseContent),
    savedAt: now,
    expiresAt: now + expiryMs,
  };
}

/**
 * The two reasons a stored draft is never handed back, per the design
 * doc's own acceptance line: it expired, or the base content it was
 * written against has since changed — "a draft against changed base
 * content does not resurrect" is exactly this second comparison.
 */
export function isDraftUsable(
  draft: DraftRecord,
  baseContent: unknown,
  now: number,
): boolean {
  if (now >= draft.expiresAt) {
    return false;
  }
  return draft.baseFingerprint === fingerprint(baseContent);
}
