/**
 * The blocker escalation message (AI-NATIVE-PLAN.md §6.4, P5-T03b).
 *
 * **The card carries the blocker's own words and a computed age, not new
 * coaching copy.** METHOD.md owns what the product says, and per-rule wording is
 * still a row of its own: what is added here is the subject's own data, which is
 * the difference between "you have a reminder waiting" and a message somebody
 * can act on without opening anything. The one sentence of product voice is the
 * generic one every nudge already carries.
 *
 * **The two actions are the two useful answers.** A ladder that has climbed past
 * the owner has reached somebody who did not raise the blocker, and what they can
 * do is close it or take it on. Handing it to a *third* person needs a person to
 * choose, which is a board's job and not a card's.
 *
 * **Both are command buttons, and that is what makes them portable.** The
 * `okr:` scheme is rendered as a card action by Teams, a Block Kit button by
 * Slack, an inline keyboard by Telegram, and by anything else as the words to
 * type. One message, four renderings, no branch on the provider anywhere.
 */
import {
  activeOnly,
  blockers,
  goals,
  keyResults,
  type WorkspaceTx,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import type { MessageDraft } from "../channels/builder.ts";

/** Rules whose subject is a blocker, from §6.4's own catalogue. */
const BLOCKER_RULES = new Set([
  "blocker.warning",
  "blocker.overdue",
  "blocker.escalated",
]);

export const isBlockerRule = (ruleKey: string): boolean =>
  BLOCKER_RULES.has(ruleKey);

/** How old, in the words a person uses rather than in hours past a hundred. */
export function ageInWords(openedAt: Date, now: Date): string {
  const hours = Math.max(
    0,
    Math.floor((now.getTime() - openedAt.getTime()) / 3_600_000),
  );
  if (hours < 1) {
    return "less than an hour";
  }
  if (hours < 48) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

/**
 * The escalation message for one blocker, or null.
 *
 * Null when the blocker has gone or has already been resolved, which is the
 * ordinary race: a nudge scheduled at eight and delivered at nine, with somebody
 * closing it in between. The caller falls back to the generic draft rather than
 * sending a card about something that is no longer true.
 */
export async function blockerDraft(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly blockerId: string;
    readonly ruleKey: string;
    readonly now: Date;
    /** The instance's own address, for the link to the board. */
    readonly baseUrl?: string;
  },
): Promise<MessageDraft | null> {
  const [row] = await tx
    .select({
      id: blockers.id,
      type: blockers.type,
      nextAction: blockers.nextAction,
      openedAt: blockers.openedAt,
      resolvedAt: blockers.resolvedAt,
      keyResultTitle: keyResults.title,
      // A blocker has no space of its own: the goal owns one, which is the
      // same route `blockers.board` takes to rank them.
      spaceId: goals.spaceId,
    })
    .from(blockers)
    .leftJoin(keyResults, eq(keyResults.id, blockers.keyResultId))
    .leftJoin(goals, eq(goals.id, keyResults.goalId))
    .where(
      activeOnly(
        blockers,
        eq(blockers.workspaceId, input.workspaceId),
        eq(blockers.id, input.blockerId),
      ),
    )
    .limit(1);

  if (!row || row.resolvedAt !== null) {
    return null;
  }

  const age = ageInWords(row.openedAt, input.now);
  const text = [
    "You have a reminder waiting in OpenOKR.",
    "",
    `A ${row.type.replace(/_/g, " ")} blocker has been open for ${age}.`,
    row.keyResultTitle ? `It blocks: ${row.keyResultTitle}` : null,
    `Next action: ${row.nextAction}`,
    "",
    `Rule: ${input.ruleKey}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  // Adaptive-card body elements. Dropped by the builder for any provider
  // without rich cards, which then has the same facts in the text above.
  const blocks: Record<string, unknown>[] = [
    {
      type: "FactSet",
      facts: [
        { title: "Open for", value: age },
        { title: "Type", value: row.type.replace(/_/g, " ") },
        ...(row.keyResultTitle
          ? [{ title: "Blocks", value: row.keyResultTitle }]
          : []),
        { title: "Next action", value: row.nextAction },
      ],
    },
  ];

  const buttons = [
    { label: "Resolve", url: `okr:resolve ${row.id}` },
    { label: "Take it on", url: `okr:take ${row.id}` },
    ...(input.baseUrl && row.spaceId
      ? [
          {
            label: "Open the board",
            url: `${trimEnd(input.baseUrl)}/spaces/${row.spaceId}`,
          },
        ]
      : []),
  ];

  return {
    subject: "OpenOKR: a blocker needs you",
    text,
    blocks,
    buttons,
  };
}

/** Trims trailing slashes without a regular expression. 47 is `/`. */
function trimEnd(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
}
