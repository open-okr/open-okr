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

/** The word for a subject type, for the group heading above its rows. */
const NAMES: Readonly<Record<string, string>> = {
  goal: "Goal",
  initiative: "Initiative",
  task: "Task",
  kpi: "KPI",
  space: "Space",
  session: "Session",
  cycle: "Cycle",
  blocker: "Blocker",
  document: "Document",
  comment: "Comment",
  check_in: "Check-in",
  member: "You",
  workspace: "Workspace",
};

export function subjectName(subjectType: string | null): string {
  if (!subjectType) {
    return "Other";
  }
  return NAMES[subjectType] ?? subjectType;
}

/** What each reason means, in the words the chip shows. */
export const REASON_LABELS: Readonly<Record<string, string>> = {
  invited: "Invited",
  joined: "Joined",
  mentioned: "Mentioned",
  role: "Role change",
  review: "To review",
  check_in: "Reminder",
};
