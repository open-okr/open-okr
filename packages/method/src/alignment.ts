/**
 * The alignment health score (METHOD.md §5.2, design `p3-t00-alignment-engine.md`,
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

/** METHOD.md §4.3 AL-3's ordering. The index is what a level skip is measured in. */
export const ALIGNMENT_LEVEL_ORDER = [
  "company",
  "department",
  "team",
  "individual",
] as const;

export type AlignmentRuleKey = "AL-1" | "AL-3" | "AL-4" | "AL-6" | "KR-1";

export type AlignmentSeverity = "high" | "medium" | "low";

/** The penalties, as §11's `alignment.penalties` parameter carries them. */
export interface AlignmentPenalties {
  readonly noAnchor: number;
  readonly orphan: number;
  readonly noKeyResults: number;
  readonly levelSkip: number;
  readonly silo: number;
  readonly floor: number;
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
  readonly parentGoalId: string | null;
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
  readonly severity: AlignmentSeverity;
  readonly penalty: number;
  /** Null only for the anchor finding, which no goal caused (decision D-16). */
  readonly subjectGoalId: string | null;
  readonly reason: string;
}

export interface AlignmentResult {
  /** Null for an empty scope: nothing to align is not the same as aligned. */
  readonly score: number | null;
  readonly findings: readonly AlignmentFinding[];
}

/**
 * Severity follows the penalty size, and is a separate axis from it on purpose:
 * severity drives how a finding is presented, the penalty drives the score.
 */
function severityFor(penalty: number): AlignmentSeverity {
  if (penalty >= 10) {
    return "high";
  }
  return penalty >= 4 ? "medium" : "low";
}

function levelIndex(level: string): number {
  return (ALIGNMENT_LEVEL_ORDER as readonly string[]).indexOf(level);
}

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

export function alignmentScore(
  graph: AlignmentGraph,
  scope: AlignmentScope,
  penalties: AlignmentPenalties,
): AlignmentResult {
  const goals = graph.goals;
  if (goals.length === 0) {
    // §1: an empty scope has no score, not 100 and not 90. A workspace with no
    // goals has nothing to align, and a penalty for an absent anchor would be
    // scolding somebody for not having started.
    return { score: null, findings: [] };
  }

  const findings: AlignmentFinding[] = [];
  const byId = new Map(goals.map((goal) => [goal.id, goal]));

  // AL-4, once, workspace scope only. "A company objective anchors the tree" is
  // not a statement about one space, so at space scope it is skipped rather than
  // failed.
  if (
    scope.kind === "workspace" &&
    !goals.some((goal) => goal.level === "company")
  ) {
    findings.push({
      ruleKey: "AL-4",
      severity: severityFor(penalties.noAnchor),
      penalty: penalties.noAnchor,
      subjectGoalId: null,
      reason: "No company-level objective anchors this cycle.",
    });
  }

  for (const goal of goals) {
    // AL-1, per goal. The contribution statement does not excuse it: §4.3's
    // check coaches the drafter, §5.2's penalty measures the structure, and
    // publish gate 3 is where a written contribution counts.
    if (goal.level !== "company" && goal.parentGoalId === null) {
      findings.push({
        ruleKey: "AL-1",
        severity: severityFor(penalties.orphan),
        penalty: penalties.orphan,
        subjectGoalId: goal.id,
        reason: `A ${goal.level} goal with no parent supports nothing above it.`,
      });
    }

    // KR-1, per goal, at every level including company.
    if (goal.keyResultCount === 0) {
      findings.push({
        ruleKey: "KR-1",
        severity: severityFor(penalties.noKeyResults),
        penalty: penalties.noKeyResults,
        subjectGoalId: goal.id,
        reason: "This objective has no key results, so nothing measures it.",
      });
    }

    // AL-3, per goal. Only a forward skip of more than one level counts. A
    // same-level or inverted parent may be worth coaching, and that belongs to
    // the quality canon rather than to the score.
    const parent = goal.parentGoalId ? byId.get(goal.parentGoalId) : undefined;
    if (parent) {
      const gap = levelIndex(goal.level) - levelIndex(parent.level);
      if (gap > 1) {
        findings.push({
          ruleKey: "AL-3",
          severity: severityFor(penalties.levelSkip),
          penalty: penalties.levelSkip,
          subjectGoalId: goal.id,
          reason: `A ${goal.level} goal aligned straight to a ${parent.level} goal skips a level.`,
        });
      }
    }
  }

  for (const siloed of siloedDepartments(graph, byId)) {
    findings.push({
      ruleKey: "AL-6",
      severity: severityFor(penalties.silo),
      penalty: penalties.silo,
      subjectGoalId: siloed,
      reason:
        "This department and its whole subtree have no horizontal dependency with any other department.",
    });
  }

  const total = findings.reduce((sum, finding) => sum + finding.penalty, 0);
  const score = Math.max(penalties.floor, Math.min(100, 100 - total));

  return { score, findings: sortFindings(findings) };
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

/** METHOD.md §5.2: at or above the threshold is healthy. */
export function alignmentHealthy(score: number, threshold: number): boolean {
  return score >= threshold;
}
