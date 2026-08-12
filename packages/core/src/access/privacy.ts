import type { AccessGroupKind } from "@openokr/db";

/**
 * Derived privacy (TECHNICAL-PLAN §4.1): "a resource's privacy label is
 * computed from which group tiers hold a binding on its context. Never a
 * stored boolean." Pure and I/O-free, so a caller can recompute it from
 * whatever group kinds it has already loaded rather than storing the answer.
 *
 * The order is the visibility order: anonymous outranks workspace_standard,
 * which outranks space_standard. A `member` binding alone, with none of the
 * wider tiers present, is exactly what invite-only means: only the people
 * named by a binding can see it.
 */
export type PrivacyLabel = "public" | "workspace" | "space" | "invite-only";

const RANK: Readonly<Record<AccessGroupKind, number>> = {
  anonymous: 3,
  workspace_standard: 2,
  space_standard: 1,
  member: 0,
};

const LABEL: readonly PrivacyLabel[] = [
  "invite-only",
  "space",
  "workspace",
  "public",
];

/**
 * `kinds` is the set of group kinds holding a live binding on the context in
 * question, however the caller loaded them. An empty set (no binding at all)
 * is invite-only: nobody but an explicit grant can see it.
 */
export function derivePrivacy(kinds: readonly AccessGroupKind[]): PrivacyLabel {
  const highest = kinds.reduce((max, kind) => Math.max(max, RANK[kind]), 0);
  return LABEL[highest] as PrivacyLabel;
}
