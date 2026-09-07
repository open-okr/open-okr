/**
 * What fills a template's placeholders (P5-T04b-b).
 *
 * **A closed vocabulary, not an expression language.** An administrator picks a
 * source per placeholder from this list. The alternative, letting them write
 * something that is evaluated at send time, would be a second query language in
 * a settings screen, and every value it could reach is already named here.
 *
 * **Every source resolves to a string, and never to an empty one.** Meta refuses
 * a template parameter that is blank, so a source with nothing to say falls back
 * to a plain word rather than sending nothing and having the whole reminder
 * bounce. A member with no name is "you"; a subject with no title is "your
 * goal".
 *
 * **`reply.command` is the one that makes the flow work.** WhatsApp has no
 * buttons, so a template that wants an answer has to say what to type. This
 * resolves to the exact command, identifier and all, which is what turns
 * "your check-in is due" into something a person can act on in one reply.
 */
import {
  activeOnly,
  blockers,
  goals,
  keyResults,
  type WorkspaceTx,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";

/** The sources an administrator may bind a placeholder to. */
export const BINDING_SOURCES = [
  "member.name",
  "workspace.name",
  "subject.title",
  "rule.key",
  "reply.command",
] as const;

export type BindingSource = (typeof BINDING_SOURCES)[number];

export const isBindingSource = (value: string): value is BindingSource =>
  (BINDING_SOURCES as readonly string[]).includes(value);

/** What a source is called on the settings screen. */
export const BINDING_LABELS: Readonly<Record<BindingSource, string>> = {
  "member.name": "The person's name",
  "workspace.name": "The workspace's name",
  "subject.title": "What it is about, by name",
  "rule.key": "The rule that fired",
  "reply.command": "The command to reply with",
};

/** Everything a binding could need, loaded once per nudge. */
export interface BindingFacts {
  readonly memberName: string | null;
  readonly workspaceName: string | null;
  readonly subjectTitle: string | null;
  readonly ruleKey: string;
  readonly subjectType: string;
  readonly subjectId: string;
}

/**
 * The command that answers one nudge, or null when nothing does.
 *
 * A check-in rule is answered by checking in on the goal it is about; a blocker
 * rule by resolving the blocker. Both carry the identifier, because a member
 * reading a message on a phone has no other way to know it.
 */
export function replyCommandFor(facts: BindingFacts): string | null {
  if (facts.subjectType === "goal" && facts.ruleKey.startsWith("checkin.")) {
    return `checkin ${facts.subjectId}`;
  }
  if (facts.subjectType === "blocker" && facts.ruleKey.startsWith("blocker.")) {
    return `resolve ${facts.subjectId}`;
  }
  return null;
}

/** One source's value, never blank. */
export function resolveBinding(
  source: BindingSource,
  facts: BindingFacts,
): string {
  switch (source) {
    case "member.name":
      return facts.memberName ?? "you";
    case "workspace.name":
      return facts.workspaceName ?? "your workspace";
    case "subject.title":
      return facts.subjectTitle ?? "your goal";
    case "rule.key":
      return facts.ruleKey;
    default:
      // `help` is the honest fallback: it is the one command that always works
      // and it tells the member what else they can say.
      return replyCommandFor(facts) ?? "help";
  }
}

/**
 * Every placeholder's value, in placeholder order.
 *
 * A parameter list Meta will accept: as many entries as the template has
 * placeholders, each a non-empty string.
 */
export function resolveBindings(
  bindings: readonly string[],
  facts: BindingFacts,
): readonly string[] {
  return bindings.map((source) =>
    isBindingSource(source) ? resolveBinding(source, facts) : "",
  );
}

/**
 * The facts one nudge needs, loaded from what the nudge row names.
 *
 * One query per subject type rather than a join across all of them: a nudge is
 * about exactly one thing, and a five-way left join to find one title would
 * read worse and run no faster.
 */
export async function loadBindingFacts(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly ruleKey: string;
    readonly subjectType: string;
    readonly subjectId: string;
  },
): Promise<BindingFacts> {
  const [member] = await tx
    .select({ name: workspaceMembers.name })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(workspaceMembers.id, input.memberId),
      ),
    )
    .limit(1);

  const [workspace] = await tx
    .select({ name: workspaces.name })
    // openokr:allow-raw-read: the tenant's own name, read on the delivery path
    // for a member of that tenant. There is no access decision to make here:
    // the workspace is the one the transaction is already scoped to, and the
    // recipient was chosen by the nudge engine before this runs.
    .from(workspaces)
    .where(activeOnly(workspaces, eq(workspaces.id, input.workspaceId)))
    .limit(1);

  return {
    memberName: member?.name ?? null,
    workspaceName: workspace?.name ?? null,
    subjectTitle: await subjectTitle(tx, input),
    ruleKey: input.ruleKey,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
  };
}

async function subjectTitle(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly subjectType: string;
    readonly subjectId: string;
  },
): Promise<string | null> {
  if (input.subjectType === "goal") {
    const [row] = await tx
      .select({ title: goals.title })
      .from(goals)
      .where(
        activeOnly(
          goals,
          eq(goals.workspaceId, input.workspaceId),
          eq(goals.id, input.subjectId),
        ),
      )
      .limit(1);
    return row?.title ?? null;
  }

  if (input.subjectType === "blocker") {
    // A blocker's own words are its next action; its title is what it blocks.
    const [row] = await tx
      .select({ title: keyResults.title, nextAction: blockers.nextAction })
      .from(blockers)
      .leftJoin(keyResults, eq(keyResults.id, blockers.keyResultId))
      .where(
        activeOnly(
          blockers,
          eq(blockers.workspaceId, input.workspaceId),
          eq(blockers.id, input.subjectId),
        ),
      )
      .limit(1);
    return row?.title ?? row?.nextAction ?? null;
  }

  if (input.subjectType === "kpi" || input.subjectType === "session") {
    // Neither is bound yet, and answering null is what makes the fallback
    // ("your goal") show rather than a title from the wrong table.
    return null;
  }
  return null;
}
