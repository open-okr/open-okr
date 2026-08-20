/**
 * The Coach's quality nudges (P4-T06a).
 *
 * AI-NATIVE-PLAN.md §6.4's second table is "the quality the Coach guards", and
 * this turns the stored evidence into the subset of it that stored evidence can
 * answer. Every message carries a §6.4 trigger key, which is the hard rule
 * CLAUDE.md states twice: a message citing a rule the package does not define
 * fails the build, and `isTriggerKey` is where that becomes true at run time.
 *
 * **The nudge points at the goal, and the goal names the failing checks.**
 * `goals.quality_flags` has held them since P4-T02a, so "cites the rule key and
 * links to the rule" is satisfied by a nudge whose `rule_key` is the §6.4
 * trigger and whose subject is the goal. A `detail` column carrying the check
 * ids as well was considered and refused: it would store a second copy of an
 * answer that already exists, and the two would disagree the moment somebody
 * edited the goal.
 *
 * **Three sources, and each is read rather than recomputed where it can be.**
 * The alignment findings are rows P3-T09 already writes, with their rule keys
 * and their reasons. The dependency register is rows P3-T09 already writes. Only
 * the key result verdicts are re-evaluated, and the note on `evaluateGoalInTx`
 * says why: a stored flag is a check id, and one check can fail for reasons §6.4
 * treats as different messages.
 */
import {
  activeOnly,
  alignmentFindings,
  goals,
  keyResultDependencies,
  keyResults,
  type WorkspaceTx,
} from "@openokr/db";
import {
  isTriggerKey,
  type ResolvedThresholds,
  trigger,
} from "@openokr/method";
import { and, eq, isNull } from "drizzle-orm";
import { OperationError } from "../operations/errors.ts";
import { evaluateGoalInTx } from "../quality/service.ts";
import { resolveManagers } from "../spaces/roles.ts";
import { spaceRoleHolders } from "./rituals.ts";
import type { DueNudge } from "./service.ts";

/**
 * §5.2's structural findings, mapped to the §6.4 trigger each one is.
 *
 * Read off both documents rather than invented: §6.4's `fires` column and §4.3's
 * check titles say the same thing in different words. Two of the five rule keys
 * the findings can carry are absent on purpose, because §6.4 names no trigger
 * for them: `AL-4`, the missing company anchor, is a property of the whole tree
 * that no goal caused, and `KR-1`, the key result count, is already the Draft
 * Coach's inline message as somebody types. Inventing a trigger for either would
 * be adding a proactive message, which CLAUDE.md puts on the ask-a-human list.
 */
const TRIGGER_FOR_FINDING: Record<string, string> = {
  "AL-1": "quality.orphan_goal",
  "AL-3": "quality.level_skip",
  "AL-6": "quality.silo",
};

/**
 * Which §6.4 trigger a failing key result check earns, by the condition that
 * matched rather than by the check id.
 *
 * KR-4 is why this is keyed on the condition. It trips on "All lagging" and on
 * "All leading", and only the first is `quality.all_lagging`; a trigger chosen
 * from the id alone would tell a champion their key results are all lagging when
 * they are all leading. KR-3 has one failing condition and could have been keyed
 * on the id, and is keyed the same way so the table has one shape.
 */
const TRIGGER_FOR_VERDICT: readonly {
  readonly id: string;
  readonly condition: string;
  readonly ruleKey: string;
}[] = [
  {
    id: "KR-4",
    condition: "All lagging",
    ruleKey: "quality.all_lagging",
  },
  {
    id: "KR-3",
    condition: "Baseline, target, date or owner missing",
    ruleKey: "quality.no_baseline",
  },
];

/** One nudge, with the rule key refused before the row exists. */
function qualityNudge(input: {
  readonly ruleKey: string;
  readonly goalId: string;
  readonly recipientMemberId: string;
}): DueNudge {
  if (!isTriggerKey(input.ruleKey)) {
    throw new OperationError(
      "forbidden",
      `\`${input.ruleKey}\` is not a rule the method package defines.`,
    );
  }
  return {
    ruleKey: input.ruleKey,
    // `quality`, not `rhythm`, and read from the catalogue rather than written
    // here: §6.4's own split is that its first table is the rhythm and its
    // second is quality, and `trigger()` carries the owner for exactly this.
    kind: trigger(input.ruleKey)?.owner === "coach" ? "quality" : "rhythm",
    subjectType: "goal",
    subjectId: input.goalId,
    recipientMemberId: input.recipientMemberId,
    channel: "in_app",
    // None of §6.4's quality triggers escalates, so none of them climbs a
    // ladder and none earns a step above zero.
    escalationStep: 0,
    // Never urgent. Every one of these repeats for as long as the goal is
    // written the way it is written, so one that bypassed the weekly ceiling
    // would drown out everything else until somebody edited the text. The
    // ceiling is what bounds a standing complaint.
    urgent: false,
  };
}

/**
 * Every quality nudge due in this workspace.
 *
 * Open goals only. A closed goal's key results cannot be improved and its
 * alignment no longer shapes anything, so coaching it is asking somebody to
 * rewrite history.
 */
export async function dueQualityNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly thresholds: ResolvedThresholds;
  },
): Promise<readonly DueNudge[]> {
  const open = await tx
    .select({
      id: goals.id,
      championId: goals.championId,
      spaceId: goals.spaceId,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        isNull(goals.closedAt),
      ),
    );

  const due: DueNudge[] = [];
  for (const goal of open) {
    due.push(...(await verdictNudges(tx, input, goal)));
    due.push(...(await dependencyNudges(tx, input.workspaceId, goal)));
  }
  due.push(...(await findingNudges(tx, input.workspaceId, open)));
  return due;
}

/** §4.2's key result checks, re-evaluated so the condition is known. */
async function verdictNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly thresholds: ResolvedThresholds;
  },
  goal: { readonly id: string; readonly championId: string | null },
): Promise<readonly DueNudge[]> {
  if (!goal.championId) {
    // §6.4 addresses both of these to the champion. A goal with none gets no
    // message rather than one to somebody who was never given the job.
    return [];
  }
  const evaluated = await evaluateGoalInTx(tx, {
    workspaceId: input.workspaceId,
    goalId: goal.id,
    thresholds: input.thresholds,
  });
  if (!evaluated) {
    return [];
  }

  const due: DueNudge[] = [];
  for (const verdict of evaluated.keyResults) {
    if (verdict.status === "pass") {
      continue;
    }
    const mapped = TRIGGER_FOR_VERDICT.find(
      (entry) =>
        entry.id === verdict.id && entry.condition === verdict.condition,
    );
    if (!mapped) {
      continue;
    }
    due.push(
      qualityNudge({
        ruleKey: mapped.ruleKey,
        goalId: goal.id,
        recipientMemberId: goal.championId,
      }),
    );
  }
  return due;
}

/**
 * §5.4's register: a dependency nobody confirmed and nobody owns the risk for.
 *
 * Both halves are required before this fires. A confirmed dependency is settled,
 * and an unconfirmed one with a named risk owner is a risk somebody is holding,
 * which is what §6.4's own wording ("Dep unconfirmed, no risk owner") says and
 * what P3-T09's gate 4 already accepts.
 */
async function dependencyNudges(
  tx: WorkspaceTx,
  workspaceId: string,
  goal: { readonly id: string; readonly championId: string | null },
): Promise<readonly DueNudge[]> {
  if (!goal.championId) {
    return [];
  }
  const rows = await tx
    .select({ id: keyResultDependencies.id })
    .from(keyResultDependencies)
    .innerJoin(keyResults, eq(keyResults.id, keyResultDependencies.keyResultId))
    .where(
      activeOnly(
        keyResultDependencies,
        eq(keyResultDependencies.workspaceId, workspaceId),
        eq(keyResults.goalId, goal.id),
        eq(keyResultDependencies.confirmed, false),
        isNull(keyResultDependencies.riskOwnerId),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    return [];
  }
  // One nudge per goal, not per dependency. The subject is the goal, so the
  // deduplication window would hold the rest anyway, and a champion with four
  // unowned dependencies needs to open the register once rather than read four
  // identical messages.
  return [
    qualityNudge({
      ruleKey: "quality.dependency_unowned",
      goalId: goal.id,
      recipientMemberId: goal.championId,
    }),
  ];
}

/** §5.2's stored structural findings, as the three triggers §6.4 names. */
async function findingNudges(
  tx: WorkspaceTx,
  workspaceId: string,
  open: readonly {
    readonly id: string;
    readonly championId: string | null;
    readonly spaceId: string | null;
  }[],
): Promise<readonly DueNudge[]> {
  const rows = await tx
    .select({
      ruleKey: alignmentFindings.ruleKey,
      subjectGoalId: alignmentFindings.subjectGoalId,
    })
    .from(alignmentFindings)
    .where(
      activeOnly(
        alignmentFindings,
        and(
          eq(alignmentFindings.workspaceId, workspaceId),
          // The Coach's own semantic findings arrive at P4-T06b and are not
          // §6.4's structural triggers. Filtering on source here is what stops
          // this reader claiming one when it lands.
          eq(alignmentFindings.source, "engine"),
        ),
      ),
    );

  const byId = new Map(open.map((goal) => [goal.id, goal]));
  const due: DueNudge[] = [];
  for (const finding of rows) {
    if (!finding.ruleKey || !finding.subjectGoalId) {
      // The anchor finding has no subject because no goal caused it (decision
      // D-16), and §6.4 names no trigger for it.
      continue;
    }
    const ruleKey = TRIGGER_FOR_FINDING[finding.ruleKey];
    const goal = byId.get(finding.subjectGoalId);
    if (!ruleKey || !goal) {
      continue;
    }

    // §6.4 sends the silo finding to the department lead rather than to the
    // champion, because a silo is a property of a subtree and no single
    // champion can clear it.
    const recipient =
      ruleKey === "quality.silo"
        ? await departmentLead(tx, goal.spaceId)
        : goal.championId;
    if (!recipient) {
      continue;
    }
    due.push(
      qualityNudge({ ruleKey, goalId: goal.id, recipientMemberId: recipient }),
    );
  }
  return due;
}

/** The space's manager, which is who §6.4's "department lead" resolves to. */
async function departmentLead(
  tx: WorkspaceTx,
  spaceId: string | null,
): Promise<string | null> {
  if (!spaceId) {
    return null;
  }
  const holders = await spaceRoleHolders(tx, spaceId);
  return resolveManagers(holders)[0] ?? null;
}
