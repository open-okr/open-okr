/**
 * The wording around an inbox row (S-03, P6-G07a).
 *
 * **The path map moved to `packages/core/src/notifications/links.ts`** at
 * P6-G01b, the moment the mailed digest needed to link to the same subject.
 * Two maps would be two answers to "where is this goal", and the digest and the
 * inbox would eventually disagree. What is left here is presentation: the word
 * for a subject type in a heading, and the word for a reason on a chip.
 *
 * `subjectLink` stays as the name this screen calls, re-exported rather than
 * rewritten at every call site, because the screen is asking a different
 * question from the mailer: it wants a path, not a URL.
 */
export {
  LINKED_SUBJECT_TYPES,
  subjectPath as subjectLink,
} from "@openokr/core";

/**
 * The catalogue key for a subject type's word, for the group heading above its
 * rows. Keys rather than words since completeness review M-15, so a Malay
 * reader's headings are Malay.
 */
const NAME_KEYS: Readonly<Record<string, string>> = {
  goal: "inbox.subject.goal",
  initiative: "inbox.subject.initiative",
  task: "inbox.subject.task",
  kpi: "inbox.subject.kpi",
  space: "inbox.subject.space",
  session: "inbox.subject.session",
  cycle: "inbox.subject.cycle",
  blocker: "inbox.subject.blocker",
  document: "inbox.subject.document",
  comment: "inbox.subject.comment",
  check_in: "inbox.subject.checkIn",
  member: "inbox.subject.member",
  workspace: "inbox.subject.workspace",
};

/** The key for a subject type's heading, or null for a type with no word. */
export function subjectNameKey(subjectType: string | null): string | null {
  if (!subjectType) {
    return "inbox.subject.other";
  }
  return NAME_KEYS[subjectType] ?? null;
}

/** The catalogue key for what each reason means, as the chip shows it. */
/**
 * What a row says when no activity stands behind it (UAT BUG-013). A
 * check-in waiting for review and a comment both notify without an activity
 * row, so they read "Something happened here." The reason is enough to say
 * what it is, and the row links to the subject for the rest.
 */
export const REASON_FALLBACK_KEYS: Readonly<Record<string, string>> = {
  review: "inbox.fallback.review",
  mentioned: "inbox.fallback.mentioned",
  joined: "inbox.fallback.joined",
  role: "inbox.fallback.role",
};

export const REASON_LABEL_KEYS: Readonly<Record<string, string>> = {
  invited: "inbox.reason.invited",
  joined: "inbox.reason.joined",
  mentioned: "inbox.reason.mentioned",
  role: "inbox.reason.role",
  review: "inbox.reason.review",
  check_in: "inbox.reason.checkIn",
};
