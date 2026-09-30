/**
 * An agent proposal as the review inbox shows it, and who may decide it
 * (UIUX-PLAN.md §4 S-02, AI-NATIVE-PLAN.md §7, completeness review M-08).
 *
 * **One rule for listing and for deciding.** The inbox lists a proposal for a
 * member, and `proposals.apply` and `proposals.dismiss` let that member decide
 * it. If the two asked different questions, a member could be told they owe a
 * decision they cannot make, which is the defect this module was written to
 * end: the row linked to `/admin/agents` and the only apply path was `full` on
 * the workspace, so an ordinary champion could see their drafted check-in and
 * do nothing about it.
 *
 * Deciding grants nothing. Applying runs the proposed action as the member, and
 * that action's own authorisation still has the last word.
 */
import { activeOnly, nudges } from "@openokr/db";
import { eq, inArray } from "drizzle-orm";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped, hasSubjectResolver } from "../access/reads.ts";
import type { OperationTx } from "../operations/operation.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";

/** The action the Champion proposes for an overdue check-in it has drafted. */
const DRAFTED_CHECK_IN = "goals.publishDraftedCheckIn";

/**
 * Whether this member reaches this resource at this level.
 *
 * A resource type the subject resolver does not know raises, and raising is
 * caught here as "no". Fail-closed is the only safe direction: the alternative
 * lists somebody else's obligation on this member's screen. The inbox's space
 * and proposal sources both ask through this one function (P6-G02), because
 * each writing its own try-catch would be one more chance to get the direction
 * wrong. Moved here from `actions/review.ts` when the proposal actions needed
 * the same answer.
 */
export async function canReach(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  resourceType: string,
  resourceId: string,
  requires: number = ACCESS_LEVELS.view,
): Promise<boolean> {
  try {
    await getAccessScoped(tx, {
      workspaceId,
      memberId,
      resourceType,
      resourceId,
      requires: requires as never,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Who each proposal was addressed to: the recipient of every nudge carrying it.
 *
 * One query for any number of proposals, so the inbox can ask about every
 * pending proposal in the workspace without a round trip for each one that
 * belongs to somebody else. A proposal no nudge carries is absent from the map.
 */
export async function proposalRecipients(
  tx: OperationTx,
  workspaceId: string,
  proposalIds: readonly string[],
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const addressed = new Map<string, Set<string>>();
  if (proposalIds.length === 0) {
    return addressed;
  }
  const rows = await tx
    .select({
      proposalId: nudges.proposalId,
      memberId: nudges.recipientMemberId,
    })
    .from(nudges)
    .where(
      activeOnly(
        nudges,
        eq(nudges.workspaceId, workspaceId),
        inArray(nudges.proposalId, [...proposalIds]),
      ),
    );
  for (const row of rows) {
    if (!row.proposalId) {
      continue;
    }
    const members = addressed.get(row.proposalId) ?? new Set<string>();
    members.add(row.memberId);
    addressed.set(row.proposalId, members);
  }
  return addressed;
}

const NOBODY: ReadonlySet<string> = new Set();

/**
 * Whether this member owes, and may make, the decision on this proposal.
 *
 * **A proposal a nudge carried is for the member the nudge was addressed to.**
 * The Champion attaches its drafted check-in to the champion's own reminder,
 * and its recovery proposal to the KPI owner's, and `nudges.proposal_id` has
 * recorded which since P4-T05c-a. That is the one person the agent asked, so
 * nobody else is shown it as something they owe. It follows METHOD.md §2.5,
 * which puts the check-in on the champion: a reviewer who can edit the goal is
 * not the person to publish a check-in in their own name. The recipient still
 * needs `edit` on a subject the access model can resolve, so a champion moved
 * off the goal since is not offered it.
 *
 * **Any other proposal, which no nudge carries, is decided by access.** A
 * member who can reach its subject at `edit` may decide it, which is the same
 * access applying it will need. One with no subject, or one whose subject type
 * the resolver does not know (a KPI has no context of its own), falls back to
 * workspace administration: fail-closed for an ordinary member, and the
 * decision still has an owner. The inbox's comment promised that fallback
 * since P6-G02; before M-08 an unresolvable type reached nobody at all.
 *
 * `addressedTo` is what `proposalRecipients` answered for this proposal, when
 * the caller already asked about many at once. Absent, this asks.
 */
export async function mayDecideProposal(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  proposal: {
    readonly id: string;
    readonly subjectType: string | null;
    readonly subjectId: string | null;
  },
  addressedTo?: ReadonlySet<string>,
): Promise<boolean> {
  const recipients =
    addressedTo ??
    (await proposalRecipients(tx, workspaceId, [proposal.id])).get(
      proposal.id,
    ) ??
    NOBODY;
  const { subjectType, subjectId } = proposal;
  const reachesSubject =
    subjectType !== null &&
    subjectId !== null &&
    hasSubjectResolver(subjectType)
      ? () =>
          canReach(
            tx,
            workspaceId,
            memberId,
            subjectType,
            subjectId,
            ACCESS_LEVELS.edit,
          )
      : null;

  if (recipients.size > 0) {
    if (!recipients.has(memberId)) {
      return false;
    }
    // A subject with no context of its own, such as a KPI, has nothing finer
    // to ask. The proposed action's own authorisation is still what decides
    // whether applying it succeeds.
    return reachesSubject ? reachesSubject() : true;
  }

  return reachesSubject
    ? reachesSubject()
    : canReach(
        tx,
        workspaceId,
        memberId,
        "workspace",
        workspaceId,
        ACCESS_LEVELS.full,
      );
}

/**
 * The row's first line: what applying it would do, and to what.
 *
 * The two actions the built-in agents propose get a sentence. Anything else,
 * which is whatever a custom agent was given, keeps the action's own name,
 * because a second description of every action in the registry would be one
 * more thing to go stale.
 */
export function proposalHeadline(
  action: string,
  subjectTitle: string | null,
): string {
  if (action === DRAFTED_CHECK_IN) {
    return subjectTitle
      ? `Publish the drafted check-in on "${subjectTitle}"`
      : "Publish a drafted check-in";
  }
  if (action === "kpis.launchRecovery") {
    return subjectTitle
      ? `Launch a recovery objective for "${subjectTitle}"`
      : "Launch a recovery objective";
  }
  const named = `Decide on the proposed ${action.replace(/\./g, " ")}`;
  return subjectTitle ? `${named} for "${subjectTitle}"` : named;
}

export interface ProposalPreviewLine {
  readonly label: string;
  readonly value: string;
}

/** Long enough for a drafted narrative's first paragraph, short enough for a row. */
const PREVIEW_LENGTH = 280;

/** `objectiveTitle` reads as "objective title". */
const labelFor = (key: string): string =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

/** An identifier names a row, and a row id means nothing to a person reading. */
const isIdentifier = (key: string): boolean =>
  key === "id" || /[a-z](Id|Ids)$/.test(key);

const scalar = (value: unknown): string | null => {
  if (typeof value === "string") {
    // `on_track` and `off_track` are values from an enum, and read as words.
    return /^[a-z]+(?:_[a-z]+)+$/.test(value)
      ? value.replace(/_/g, " ")
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const truncate = (text: string): string =>
  text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;

/**
 * What a proposal would change, as label and value pairs.
 *
 * The same shape `copilot.proposals` returns, so a surface that renders one
 * renders both. An agent proposal carries no preview of its own, so this reads
 * the payload: plain values first in the order they were stored, then any
 * editor document as its text, then anything structured as it is. Identifiers
 * and empty lists are left out, and nothing else is: a person deciding a
 * change has to be able to see all of it.
 */
export function proposalPreview(
  payload: Record<string, unknown>,
): ProposalPreviewLine[] {
  const plain: ProposalPreviewLine[] = [];
  const prose: ProposalPreviewLine[] = [];
  const structured: ProposalPreviewLine[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (
      value === null ||
      value === undefined ||
      isIdentifier(key) ||
      (Array.isArray(value) && value.length === 0)
    ) {
      continue;
    }
    const label = labelFor(key);
    const simple = scalar(value);
    if (simple !== null) {
      plain.push({ label, value: truncate(simple) });
    } else if (isValidRichText(value, RICH_TEXT_SCHEMA_VERSION)) {
      prose.push({ label, value: excerptRichText(value, PREVIEW_LENGTH) });
    } else if (
      Array.isArray(value) &&
      value.every((item) => scalar(item) !== null)
    ) {
      plain.push({ label, value: truncate(value.map(scalar).join(", ")) });
    } else {
      structured.push({ label, value: truncate(JSON.stringify(value)) });
    }
  }
  return [...plain, ...prose, ...structured];
}
