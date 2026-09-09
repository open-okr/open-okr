/**
 * A workspace's own escalation ladder, per rule (METHOD.md §11, P6-G21b).
 *
 * **`nudge_rules.escalation_ladder` has been stored since P4-T04b and read by
 * nothing.** The column, its comment and the admin screen all said a workspace
 * could replace §11's ladder for one rule; every consumer read the canon and
 * ignored the row. This is the read.
 *
 * **One rule owns each ladder, and it is the rule the ladder escalates to.**
 * §11 defines three ladders and the §6.4 catalogue defines twenty-four
 * triggers, so the mapping is many to one: `blocker.warning`,
 * `blocker.overdue` and `blocker.escalated` are three rungs of one ladder, not
 * three ladders. Hanging the override on all three would let a workspace store
 * three answers to one question and make the read order-dependent, which is
 * the same defect the table's own unique index exists to stop. So the owner is
 * named here, the editor offers the ladder only there, and the card says which
 * triggers it governs.
 *
 * **The canon is the fallback, and an unreadable row falls back to it too.**
 * A stored ladder is validated against the threshold registry's own schema on
 * every read rather than only on write, because a row written by an older
 * release, by hand, or by a restore is a row this code did not write. Canon is
 * always answerable, so there is no state in which escalation stops working.
 */
import { activeOnly, nudgeRules, type WorkspaceTx } from "@openokr/db";
import { type ResolvedThresholds, THRESHOLDS } from "@openokr/method";
import { eq } from "drizzle-orm";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/** The three §11 ladders a workspace may replace, and who owns each. */
export interface LadderOwner {
  /** The rule the editor hangs this ladder on. */
  readonly ruleKey: string;
  /** The §11 registry key whose default is the canon ladder. */
  readonly threshold: keyof ResolvedThresholds;
  /** The rungs, in the order they must increase. */
  readonly rungs: readonly string[];
  /** Every §6.4 trigger this one ladder decides, for the card to name. */
  readonly governs: readonly string[];
}

export const LADDER_OWNERS: readonly LadderOwner[] = [
  {
    ruleKey: "checkin.overdue",
    threshold: "cadence.checkInLadderDays",
    rungs: ["championRepeat", "coordinator", "sponsor"],
    governs: ["checkin.due_soon", "checkin.due", "checkin.overdue"],
  },
  {
    ruleKey: "ack.overdue",
    threshold: "cadence.acknowledgementLadderDays",
    rungs: ["nudge", "escalate"],
    governs: ["ack.owed", "ack.overdue"],
  },
  {
    ruleKey: "blocker.escalated",
    threshold: "cadence.blockerLadderHours",
    rungs: ["owner", "coordinator", "sponsor"],
    governs: ["blocker.warning", "blocker.overdue", "blocker.escalated"],
  },
];

export const ladderOwnerFor = (ruleKey: string): LadderOwner | undefined =>
  LADDER_OWNERS.find((owner) => owner.ruleKey === ruleKey);

/**
 * Whether a stored ladder is one §11 would accept.
 *
 * Two checks, and the second is not in the registry's schema. The registry
 * types each rung (whole days, positive hours) and says nothing about their
 * order, because a canon ladder is written in order by hand. A workspace
 * editing one can put the sponsor before the coordinator, and a ladder whose
 * rungs are out of order does not widen: it fires the top rung first and the
 * ones below it never fire at all.
 */
export function ladderProblem(
  owner: LadderOwner,
  value: unknown,
): string | null {
  const parsed = THRESHOLDS[owner.threshold].schema.safeParse(value);
  if (!parsed.success) {
    return `That is not a ${THRESHOLDS[owner.threshold].label.toLowerCase()} §11 would recognise.`;
  }
  const rungs = parsed.data as Record<string, number>;
  for (let i = 1; i < owner.rungs.length; i++) {
    const before = owner.rungs[i - 1] as string;
    const after = owner.rungs[i] as string;
    if ((rungs[after] as number) <= (rungs[before] as number)) {
      return `${after} must come after ${before}. A ladder whose rungs are out of order fires its top rung first and never reaches the ones below it.`;
    }
  }
  return null;
}

/**
 * The ladder in force for one rule: the workspace's own, or §11's.
 *
 * `stored` is whatever the row holds, which may be null, may be a shape an
 * older release wrote, and is never trusted.
 */
function resolveLadder<T>(owner: LadderOwner, stored: unknown, canon: T): T {
  if (stored === null || stored === undefined) {
    return canon;
  }
  if (ladderProblem(owner, stored) !== null) {
    return canon;
  }
  return THRESHOLDS[owner.threshold].schema.parse(stored) as T;
}

/**
 * Every ladder this workspace has replaced, by rule key.
 *
 * One read for all three, because a caller that needs one usually needs it
 * once per request and three round trips for three rows is three round trips.
 */
async function readRuleLadders<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
): Promise<ReadonlyMap<string, unknown>> {
  const rows = await tx
    .select({
      ruleKey: nudgeRules.ruleKey,
      escalationLadder: nudgeRules.escalationLadder,
    })
    .from(nudgeRules)
    .where(activeOnly(nudgeRules, eq(nudgeRules.workspaceId, workspaceId)));

  const map = new Map<string, unknown>();
  for (const row of rows) {
    if (row.escalationLadder !== null) {
      map.set(row.ruleKey, row.escalationLadder);
    }
  }
  return map;
}

/**
 * A workspace's rhythm, with any ladder it has replaced already substituted
 * (P6-G21b).
 *
 * **One function rather than a substitution at each read.** Four places
 * consume a §11 ladder: the blocker board, the review screen, the obligation
 * reader and the cadence sweep that produces the nudges. Each of them already
 * held a `ResolvedThresholds` and read a rung out of it, so the honest place
 * to apply an override is where that object is built. A consumer added later
 * gets the workspace's ladder without knowing this module exists, which is the
 * property the column lacked for two phases.
 *
 * `resolveRhythm` itself cannot do it: it is pure, and this needs a row.
 */
export async function resolveRhythmWithLadders<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  rhythm: { readonly thresholds: ResolvedThresholds },
): Promise<ResolvedThresholds> {
  const stored = await readRuleLadders(tx, workspaceId);
  if (stored.size === 0) {
    return rhythm.thresholds;
  }

  const thresholds = { ...rhythm.thresholds };
  for (const owner of LADDER_OWNERS) {
    const own = stored.get(owner.ruleKey);
    if (own === undefined) {
      continue;
    }
    // `resolveLadder` returns the canon back when the row is unreadable, so an
    // older release's shape costs a fallback rather than an exception.
    (thresholds as Record<string, unknown>)[owner.threshold] = resolveLadder(
      owner,
      own,
      thresholds[owner.threshold],
    );
  }
  return thresholds;
}
