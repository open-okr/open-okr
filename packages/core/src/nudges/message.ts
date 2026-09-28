/**
 * What a nudge says when it leaves the product (completeness review H-12).
 *
 * Every nudge but a blocker's reached email, Slack, Teams and Telegram as "You
 * have a reminder waiting in OpenOKR. Rule: checkin.due": no goal, no link, no
 * button, although REQUIREMENTS §3.8 asks for a one-tap check-in and Pillar E
 * for one-click check-in links in email.
 *
 * **No coaching copy is written here.** The headline is the rule's own name
 * from `packages/method`'s catalogue, the same words the nudge volume page
 * shows; the rest is facts: what it is about, where to open it, and the rule
 * key every proactive message carries.
 *
 * **The links are plain deep links, not sign-in tokens.** A link that signs
 * somebody in from an inbox is a credential in an email, and nothing here is
 * worth that: the link opens the page, and the ordinary sign-in stands in
 * front of it.
 */
import {
  activeOnly,
  checkIns,
  cycles,
  goals,
  kpis,
  okrSessions,
  type WorkspaceTx,
} from "@openokr/db";
import { trigger } from "@openokr/method";
import { eq } from "drizzle-orm";
import type { MessageButton, MessageDraft } from "../channels/builder.ts";
import type { ChannelProviderKey } from "../channels/capabilities.ts";
import { withoutTrailingSlashes } from "../urls.ts";

/** The check-in rules, whose message offers the check-in itself. */
const CHECK_IN_RULES = new Set([
  "checkin.due_soon",
  "checkin.due",
  "checkin.overdue",
  "checkin.stale",
]);

interface Subject {
  /** What the message names: a goal's title, a session's, a cycle's name. */
  readonly name: string | null;
  /** The path under the instance's address that opens it. */
  readonly path: string;
  /** The goal a check-in would be about, when there is one. */
  readonly goalId: string | null;
}

async function subjectOf(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly ruleKey: string;
  },
): Promise<Subject> {
  const goalSubject = async (goalId: string): Promise<Subject> => {
    const [row] = await tx
      .select({ title: goals.title })
      .from(goals)
      .where(activeOnly(goals, eq(goals.id, goalId)))
      .limit(1);
    return {
      name: row?.title ?? null,
      path: CHECK_IN_RULES.has(input.ruleKey)
        ? `/check-in?goal=${goalId}`
        : `/goals/${goalId}`,
      goalId,
    };
  };

  switch (input.subjectType) {
    case "goal":
      return goalSubject(input.subjectId);
    case "check_in": {
      const [row] = await tx
        .select({ goalId: checkIns.subjectId })
        .from(checkIns)
        .where(activeOnly(checkIns, eq(checkIns.id, input.subjectId)))
        .limit(1);
      return row
        ? { ...(await goalSubject(row.goalId)), path: `/goals/${row.goalId}` }
        : { name: null, path: "/review", goalId: null };
    }
    case "kpi": {
      const [row] = await tx
        .select({ title: kpis.title })
        .from(kpis)
        .where(activeOnly(kpis, eq(kpis.id, input.subjectId)))
        .limit(1);
      return {
        name: row?.title ?? null,
        path: `/kpis/${input.subjectId}`,
        goalId: null,
      };
    }
    case "session": {
      const [row] = await tx
        .select({ title: okrSessions.title })
        .from(okrSessions)
        .where(activeOnly(okrSessions, eq(okrSessions.id, input.subjectId)))
        .limit(1);
      return {
        name: row?.title ?? null,
        path: `/session/${input.subjectId}`,
        goalId: null,
      };
    }
    case "cycle": {
      const [row] = await tx
        .select({ name: cycles.name })
        .from(cycles)
        .where(activeOnly(cycles, eq(cycles.id, input.subjectId)))
        .limit(1);
      return { name: row?.name ?? null, path: "/cycle", goalId: null };
    }
    default:
      // A member: the message is about their own day, and the inbox is where
      // that lives.
      return { name: null, path: "/inbox", goalId: null };
  }
}

/**
 * One nudge's message for one provider.
 *
 * A chat provider gets the check-in as a command button, which starts the
 * conversational check-in where the message arrived; email gets it as a link,
 * because a command in an email is a line nothing happens to.
 */
export async function nudgeDraft(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly ruleKey: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly provider: ChannelProviderKey;
    readonly baseUrl?: string;
  },
): Promise<MessageDraft> {
  const title = trigger(input.ruleKey)?.title ?? input.ruleKey;
  const subject = await subjectOf(tx, input);
  const link = input.baseUrl
    ? `${withoutTrailingSlashes(input.baseUrl)}${subject.path}`
    : null;

  const buttons: MessageButton[] = [];
  if (CHECK_IN_RULES.has(input.ruleKey) && subject.goalId) {
    if (input.provider === "email") {
      if (link) {
        buttons.push({ label: "Check in", url: link });
      }
    } else {
      buttons.push({
        label: "Check in",
        url: `okr:checkin ${subject.goalId}`,
      });
    }
  }
  if (link && !(input.provider === "email" && buttons.length > 0)) {
    buttons.push({ label: "Open in OpenOKR", url: link });
  }

  const headline = subject.name ? `${title}: ${subject.name}` : title;
  return {
    subject: `OpenOKR: ${headline}`,
    text: [
      headline,
      "",
      // The rule key, on this message as on every other proactive message.
      `Rule: ${input.ruleKey}`,
    ].join("\n"),
    ...(buttons.length > 0 ? { buttons } : {}),
  };
}
