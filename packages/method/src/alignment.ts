/**
 * The alignment health score (METHOD.md §5.2, design `alignment-engine.md`,
 * P3-T09).
 *
 * **This landed in `packages/method`, not `packages/core` as the design document
 * said**, for the same reason the scoring engine moved at P3-T05 and the design
 * document is corrected in the same change. Every function here is a §5.2 rule
 * taking a §11 threshold as an argument, and the repository rule puts those in
 * the method package and nowhere else. `packages/core/src/alignment/` is the half
 * that needs rows: it loads the graph and writes the findings.
 *
 * Pure. No database, no network, no clock. The same code runs in the browser as
 * somebody drags a goal onto a new parent, on the server before a write, and
 * inside the Coach when it wants to know what the structure already says before
 * it adds an opinion about the words.
 *
 * Deterministic and fully available with the AI provider off. The Coach adds
 * semantic findings (§5.3) into the same table at P4-T03; nothing here ever
 * reads or writes one.
 */

import { enforcementLevel } from "./enforcement.ts";
import type { ResolvedPractice } from "./practice.ts";

/**
 * METHOD.md §4.3 AL-3's ordering. A level skip is measured over the levels a
 * cycle uses, taken in this order (§2.7, G-3).
 */
export const ALIGNMENT_LEVEL_ORDER = [
  "company",
  "department",
  "team",
  "individual",
] as const;

export type AlignmentRuleKey = "AL-1" | "AL-3" | "AL-4" | "AL-6" | "KR-1";

export type AlignmentSeverity = "high" | "medium" | "low";

/** §5.2's three readings of the share. */
export const ALIGNMENT_BANDS = ["healthy", "watch", "gap"] as const;
export type AlignmentBand = (typeof ALIGNMENT_BANDS)[number];

/** §11's two alignment thresholds, as percentages. */
export interface AlignmentThresholds {
  readonly healthy: number;
  readonly watch: number;
}

/**
 * One goal, as the score needs to see it.
 *
 * `parentGoalId` is already resolved. A goal may point at a parent goal or at a
 * parent key result, and §3.4 says a key result parent takes the level of the
 * goal that owns it, so the caller resolves the pointer to its owning goal and
 * the engine never has to know which kind it was.
 */
export interface AlignmentGoal {
  readonly id: string;
  readonly level: string;
  /** The parent inside the scope, which is what the subtree walks follow. */
  readonly parentGoalId: string | null;
  /**
   * The level of a parent outside the scope: another space, or an earlier or
   * longer cycle such as an annual objective (§5.1). Null or absent when the
   * parent is inside the scope or there is none.
   *
   * Carried separately because a parent the engine cannot see still aligns the
   * goal. Before P9-T16a a space's goal hung under the company objective read
   * as unaligned at space scope, which counted it against the share it most
   * plainly belongs in.
   */
  readonly outsideParentLevel?: string | null;
  /** Why this goal stands alone, when it does (§5.2). Counts as aligned. */
  readonly standaloneReason?: string | null;
  /**
   * What it says it contributes to (§4.3, AL-1). Enough for AL-1 to pass and
   * not enough for the share, which asks for a parent or a reason.
   */
  readonly contributionStatement?: string | null;
  readonly spaceId: string | null;
  readonly keyResultCount: number;
  /** Closed goals still count (decision D-11). Carried for the caller's clarity. */
  readonly closed?: boolean;
}

export interface AlignmentGraph {
  readonly goals: readonly AlignmentGoal[];
  /** Stored once; direction carries no meaning (§5.1). */
  readonly goalDependencies: readonly {
    readonly from: string;
    readonly to: string;
  }[];
  /** One row per register entry, reduced to the goal that depends and who provides. */
  readonly keyResultDependencies: readonly {
    readonly goalId: string;
    readonly providerSpaceId: string | null;
  }[];
}

export type AlignmentScope =
  | { readonly kind: "workspace" }
  | { readonly kind: "space"; readonly spaceId: string };

export interface AlignmentFinding {
  readonly ruleKey: AlignmentRuleKey;
  /**
   * The §4.3 condition row that matched, where the check has more than one
   * way to object (AL-1's missing alignment and its short contribution).
   */
  readonly condition?: string;
  readonly severity: AlignmentSeverity;
  /** Null only for the anchor finding, which no goal caused (decision D-16). */
  readonly subjectGoalId: string | null;
  readonly reason: string;
}

export interface AlignmentResult {
  /**
   * The share of goals below company level that align or stand alone with a
   * reason, as a whole percentage rounded down. Null when there is nothing
   * below company level to measure: nothing to align is not the same as
   * aligned.
   */
  readonly score: number | null;
  readonly band: AlignmentBand | null;
  /** Goals below company level in scope: the share's denominator. */
  readonly measured: number;
  /** Of those, the ones aligned or standing alone with a reason. */
  readonly counted: number;
  /**
   * The goals the share did not count, sorted. §5.2 lists every one, whether
   * or not a check is raised against it: a goal that states a contribution
   * passes AL-1 and is still not counted, and AL-1 may be off.
   */
  readonly uncounted: readonly string[];
  readonly findings: readonly AlignmentFinding[];
}

/** How the engine reads a cycle (§2.7, §4.3). */
export interface AlignmentOptions {
  /**
   * The levels the cycle uses, which AL-3 measures a skip over (G-3). A level
   * a workspace turned off is not counted as skipped. All four by default.
   */
  readonly levels?: readonly string[];
  /** §11's "Contribution minimum", in words. 3 by default. */
  readonly contributionMinimum?: number;
}

/** §4.3's AL-1 rows, as `ALIGNMENT_CHECKS` words them. */
export const AL1_UNALIGNED =
  "No parent, no stated contribution and no standalone reason";
export const AL1_SHORT_CONTRIBUTION =
  "Stated contribution under the contribution minimum";

/**
 * How each finding is presented. Fixed per rule since P9-T16a, when the
 * penalties it used to be read off left §5.2; the values are the ones the
 * penalties produced, so no finding changed colour on the way.
 */
const SEVERITY: Readonly<Record<AlignmentRuleKey, AlignmentSeverity>> = {
  "AL-4": "high",
  "AL-1": "high",
  "KR-1": "medium",
  "AL-6": "medium",
  "AL-3": "low",
};

/**
 * The department a goal belongs to, keyed for grouping.
 *
 * A department is a distinct owning space among the department-level goals in
 * scope. A department-level goal with no space forms its own group keyed by its
 * own identifier, so an unassigned department is still measured rather than
 * silently exempt.
 */
function departmentKey(goal: AlignmentGoal): string {
  return goal.spaceId ?? `goal:${goal.id}`;
}

/**
 * METHOD.md §5.2: the share of goals below company level that align to a
 * parent or say why they stand alone.
 *
 * A share rather than penalties (P9-T16a). Fixed penalties cost the same
 * points in a company of ten goals and one of five hundred, so eight unaligned
 * goals took either to the floor. The findings are still raised, because the
 * coach lists every unaligned goal and the nudges are keyed on them, but only
 * the share decides the reading.
 */
export function alignmentScore(
  graph: AlignmentGraph,
  scope: AlignmentScope,
  thresholds: AlignmentThresholds,
  options: AlignmentOptions = {},
): AlignmentResult {
  const goals = graph.goals;
  if (goals.length === 0) {
    // An empty scope has no score, not 100 and not 0. A workspace with no
    // goals has nothing to align, and an anchor finding would be scolding
    // somebody for not having started.
    return {
      score: null,
      band: null,
      measured: 0,
      counted: 0,
      uncounted: [],
      findings: [],
    };
  }
  const levels = options.levels ?? ALIGNMENT_LEVEL_ORDER;
  const contributionMinimum = options.contributionMinimum ?? 3;

  const findings: AlignmentFinding[] = [];
  const byId = new Map(goals.map((goal) => [goal.id, goal]));

  // AL-4, once, workspace scope only. "A company objective anchors the tree" is
  // not a statement about one space, so at space scope it is skipped rather than
  // failed. A goal hung under an annual company objective is anchored by it,
  // because §5.1 lets a quarter's goals align to a longer cycle's.
  const anchored =
    scope.kind !== "workspace" ||
    goals.some(
      (goal) =>
        goal.level === "company" || goal.outsideParentLevel === "company",
    );
  if (!anchored) {
    findings.push({
      ruleKey: "AL-4",
      severity: SEVERITY["AL-4"],
      subjectGoalId: null,
      reason: "No company-level objective anchors this cycle.",
    });
  }

  let measured = 0;
  let counted = 0;
  const uncounted: string[] = [];
  for (const goal of goals) {
    const parentLevel = goal.parentGoalId
      ? (byId.get(goal.parentGoalId)?.level ?? null)
      : (goal.outsideParentLevel ?? null);
    const aligned = parentLevel !== null || hasReason(goal.standaloneReason);
    const contribution = wordCount(goal.contributionStatement);

    if (goal.level !== "company") {
      measured += 1;
      // The share. A reason to stand alone counts as aligned (§5.2); a
      // contribution statement does not, because it says what the goal
      // supports without pointing at it.
      if (aligned) {
        counted += 1;
      } else {
        uncounted.push(goal.id);
      }
    }

    // AL-1, per goal, first match wins (§4.3). A stated contribution is
    // enough for the check, which coaches the writer, though not for the
    // share, which measures the structure.
    if (goal.level !== "company" && !aligned && contribution === 0) {
      findings.push({
        ruleKey: "AL-1",
        condition: AL1_UNALIGNED,
        severity: SEVERITY["AL-1"],
        subjectGoalId: goal.id,
        reason: `This ${goal.level} goal has no parent, states no contribution and gives no reason to stand alone.`,
      });
    } else if (contribution > 0 && contribution < contributionMinimum) {
      findings.push({
        ruleKey: "AL-1",
        condition: AL1_SHORT_CONTRIBUTION,
        severity: SEVERITY["AL-1"],
        subjectGoalId: goal.id,
        reason: `Its stated contribution is under ${contributionMinimum} words, which names a theme rather than a goal.`,
      });
    }

    // KR-1, per goal, at every level including company.
    if (goal.keyResultCount === 0) {
      findings.push({
        ruleKey: "KR-1",
        severity: SEVERITY["KR-1"],
        subjectGoalId: goal.id,
        reason: "This objective has no key results, so nothing measures it.",
      });
    }

    // AL-3, per goal. Only a forward skip of more than one level counts, over
    // the levels this cycle uses: with no department level, a team goal under
    // a company one skips nothing (G-3). A same-level or inverted parent may
    // be worth coaching, and that belongs to the quality canon rather than to
    // the score.
    if (parentLevel !== null) {
      const order = levelsBetween(levels, goal.level, parentLevel);
      const gap = order.indexOf(goal.level) - order.indexOf(parentLevel);
      if (gap > 1) {
        findings.push({
          ruleKey: "AL-3",
          severity: SEVERITY["AL-3"],
          subjectGoalId: goal.id,
          reason: `A ${goal.level} goal aligned straight to a ${parentLevel} goal skips a level.`,
        });
      }
    }
  }

  for (const siloed of siloedDepartments(graph, byId)) {
    findings.push({
      ruleKey: "AL-6",
      severity: SEVERITY["AL-6"],
      subjectGoalId: siloed,
      reason:
        "This department and its whole subtree have no horizontal dependency with any other department.",
    });
  }

  // Rounded down, so a share of 89.6 reads 89 and the figure never shows a
  // band it has not reached.
  const score = measured === 0 ? null : Math.floor((100 * counted) / measured);
  return {
    score,
    band: score === null ? null : alignmentBand(score, thresholds, anchored),
    measured,
    counted,
    uncounted: uncounted.sort((left, right) => left.localeCompare(right)),
    findings: sortFindings(findings),
  };
}

/**
 * Drops the findings of a check this practice turned off (§4, §12, P9-T16b-a).
 *
 * A separate step, as `applyEnforcement` is for the other checks: the engine
 * reports what it sees and the practice decides what is said. AL-3 and AL-6
 * are off by default, so their findings, and the nudges keyed on them, stop
 * by default too. The share is §5.2's and does not move: a workspace that
 * turns AL-1 off still sees every goal the share did not count.
 */
export function enforceAlignment(
  result: AlignmentResult,
  practice: ResolvedPractice,
): AlignmentResult {
  return {
    ...result,
    findings: result.findings.filter(
      (finding) => enforcementLevel(finding.ruleKey, practice) !== "off",
    ),
  };
}

function hasReason(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.trim().length > 0;
}

function wordCount(text: string | null | undefined): number {
  return (text ?? "")
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "").length;
}

/**
 * The cycle's levels in §4.3's order, plus the two levels being compared, so
 * a goal at a level the cycle did not begin with is still measured from where
 * it sits.
 */
function levelsBetween(
  levels: readonly string[],
  child: string,
  parent: string,
): readonly string[] {
  return ALIGNMENT_LEVEL_ORDER.filter(
    (level) => levels.includes(level) || level === child || level === parent,
  );
}

/**
 * One representative goal id per siloed department.
 *
 * The subject is a goal rather than a space because a finding has to open
 * something, and §5.2 says each one links straight to the goal that caused it.
 * The lowest id among the department's own department-level goals is used, so
 * the answer is stable across recomputes and a finding keeps its identity.
 */
function siloedDepartments(
  graph: AlignmentGraph,
  byId: Map<string, AlignmentGoal>,
): string[] {
  const departments = new Map<string, AlignmentGoal[]>();
  for (const goal of graph.goals) {
    if (goal.level !== "department") {
      continue;
    }
    const key = departmentKey(goal);
    const existing = departments.get(key);
    if (existing) {
      existing.push(goal);
    } else {
      departments.set(key, [goal]);
    }
  }
  if (departments.size === 0) {
    return [];
  }

  // Children by parent, once, so building every subtree is one pass rather than
  // one scan of every goal per department.
  const childrenOf = new Map<string, string[]>();
  for (const goal of graph.goals) {
    if (!goal.parentGoalId) {
      continue;
    }
    const siblings = childrenOf.get(goal.parentGoalId);
    if (siblings) {
      siblings.push(goal.id);
    } else {
      childrenOf.set(goal.parentGoalId, [goal.id]);
    }
  }

  const subtrees = new Map<string, Set<string>>();
  for (const [key, roots] of departments) {
    const members = new Set<string>();
    const stack = roots.map((goal) => goal.id);
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (members.has(id)) {
        // A parent cycle cannot be created through the interface, but a bad
        // import could, and an engine that hangs on one is worse than one that
        // stops walking.
        continue;
      }
      members.add(id);
      for (const child of childrenOf.get(id) ?? []) {
        stack.push(child);
      }
    }
    subtrees.set(key, members);
  }

  const linked = new Set<string>();

  // A goal dependency clears a department when one end is inside its subtree and
  // the other is outside. A link between a department and its own team is
  // internal, and is the case an implementation gets wrong.
  for (const dependency of graph.goalDependencies) {
    for (const [key, members] of subtrees) {
      const fromInside = members.has(dependency.from);
      const toInside = members.has(dependency.to);
      if (fromInside !== toInside) {
        linked.add(key);
      }
    }
  }

  // A key result dependency clears both ends. §5.1 calls a horizontal dependency
  // two-way by meaning, and a department that three other teams depend on is the
  // least siloed department in the organisation: flagging it because it happened
  // to be the provider rather than the consumer would be absurd (decision D-7).
  for (const dependency of graph.keyResultDependencies) {
    const provider = dependency.providerSpaceId;
    if (!provider) {
      // A provider named only as text is real to the people involved, but the
      // engine cannot find it, so it cannot prove the link crosses a boundary.
      continue;
    }
    for (const [key, members] of subtrees) {
      if (members.has(dependency.goalId) && key !== provider) {
        linked.add(key);
      }
    }
    if (subtrees.has(provider)) {
      linked.add(provider);
    }
  }

  const siloed: string[] = [];
  for (const [key, roots] of departments) {
    if (linked.has(key)) {
      continue;
    }
    const subject = roots
      .map((goal) => goal.id)
      .sort((left, right) => left.localeCompare(right))[0];
    if (subject && byId.has(subject)) {
      siloed.push(subject);
    }
  }
  return siloed;
}

/** Stable order: rule key, then subject. A finding list that reorders reads as churn. */
function sortFindings(findings: AlignmentFinding[]): AlignmentFinding[] {
  return [...findings].sort((left, right) => {
    const byKey = left.ruleKey.localeCompare(right.ruleKey);
    if (byKey !== 0) {
      return byKey;
    }
    return (left.subjectGoalId ?? "").localeCompare(right.subjectGoalId ?? "");
  });
}

/**
 * METHOD.md §5.2: healthy at or above the healthy threshold, watch at or above
 * the watch threshold, a gap below it. With no company-level objective the
 * reading is a gap whatever the share, because a tree with nothing at the top
 * can be perfectly wired and still point nowhere.
 */
export function alignmentBand(
  score: number,
  thresholds: AlignmentThresholds,
  anchored = true,
): AlignmentBand {
  if (!anchored) {
    return "gap";
  }
  if (score >= thresholds.healthy) {
    return "healthy";
  }
  return score >= thresholds.watch ? "watch" : "gap";
}
