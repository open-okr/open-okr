/**
 * The divergence sweep (AI-NATIVE-PLAN.md §6.1 item 3, P4-T06b-a).
 *
 * Reads the stored answer rather than recomputing it. `goals.progress_pct`,
 * `goals.health` and `key_results.confidence` are all written by the scoring
 * recompute inside the transaction that changed them, so a sweep that derived
 * progress again would be a second opinion about a number the product already
 * committed to and shows on the goal page.
 *
 * The rule is `packages/method/src/divergence.ts`, pure and reading only §11
 * parameters that already existed. This loads the rows and reconciles the
 * findings table, through the same `reconcileFindingsInTx` the structural engine
 * uses, so "a dismissal survives" and "a cleared condition disappears" are one
 * implementation rather than two promises.
 *
 * **Source `coach`, kind `divergence`.** The engine's structural findings and
 * these live in one table and are reconciled in separate slices, which is why
 * `reconcileFindingsInTx` keys on (scope, source, kind): a divergence sweep must
 * not soft-delete a structural finding for being absent from its list, and it
 * must not touch the semantic kinds P4-T06b-b will add.
 *
 * **Two kinds of divergence, and the second is per key result (P5-T14).** §6.1's
 * two cases are about a goal's own health against its own data, and one goal has
 * one health, so one finding. TECHNICAL-PLAN §4.9's case is about a measure
 * against the work behind it, and a goal has as many measures as it has key
 * results: three that each finished their plan without moving are three separate
 * conversations, and dismissing one must leave the other two. That is what
 * `subject_key_result_id` widened the finding identity for.
 *
 * The rule is `packages/method/src/linked-work.ts`, pure, and it names both
 * figures in one sentence. No new METHOD.md rule and no new §11 threshold: the
 * comparison is between two facts the product already holds, and the message
 * cites `quality.divergence`, the rule §6.4 already defines.
 */
import { activeOnly, goals, keyResults } from "@openokr/db";
import {
  averageConfidence,
  divergences,
  linkedWorkDivergence,
  progressSignal,
  type ResolvedThresholds,
} from "@openokr/method";
import { eq, isNull } from "drizzle-orm";
import type { OperationTx } from "../operations/operation.ts";
import { linkedWorkForKeyResults } from "../tasks/service.ts";
import { reconcileFindingsInTx, type WantedFinding } from "./service.ts";

/** What the sweep found, for the run log rather than for a caller's logic. */
export interface DivergenceSweepResult {
  readonly examined: number;
  readonly found: number;
}

/**
 * Sweeps one cycle for divergence and reconciles the findings.
 *
 * Workspace scope only. Divergence is a property of one goal against its own
 * data, so unlike §5.2's structural score there is nothing a space scope would
 * answer differently, and writing the same finding into two slices would show a
 * facilitator the same row twice and need two dismissals for one decision.
 *
 * A closed goal is skipped. Its health is `achieved` or `missed`, neither of
 * which claims anything about the future, and the pure rule refuses those
 * statuses anyway; skipping them here keeps the query honest about what it is
 * asking rather than relying on the rule to reject rows it should not have been
 * given.
 */
export async function sweepDivergenceInTx(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly cycleId: string;
    readonly thresholds: ResolvedThresholds;
  },
): Promise<DivergenceSweepResult> {
  const open = await tx
    .select({
      id: goals.id,
      health: goals.health,
      progressPct: goals.progressPct,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        eq(goals.cycleId, input.cycleId),
        isNull(goals.closedAt),
      ),
    );

  const wanted: WantedFinding[] = [];

  for (const goal of open) {
    const measures = await tx
      .select({
        id: keyResults.id,
        title: keyResults.title,
        confidence: keyResults.confidence,
        currentValue: keyResults.currentValue,
        baselineValue: keyResults.baselineValue,
      })
      .from(keyResults)
      .where(activeOnly(keyResults, eq(keyResults.goalId, goal.id)));
    const confidences = measures;

    // TECHNICAL-PLAN §4.9's case, one per measure (P5-T14). Counted rather than
    // derived from progress: finishing work moves no number, and the point of
    // this finding is precisely that it did not.
    const linkedWork = await linkedWorkForKeyResults(
      tx,
      input.workspaceId,
      measures.map((measure) => measure.id),
    );
    for (const measure of measures) {
      const found = linkedWorkDivergence({
        keyResultTitle: measure.title,
        work: linkedWork.get(measure.id) ?? { done: 0, total: 0 },
        currentValue: Number(measure.currentValue),
        baselineValue: Number(measure.baselineValue),
      });
      if (found) {
        wanted.push({
          ruleKey: "quality.divergence",
          subjectGoalId: goal.id,
          targetGoalId: null,
          // The goal is still named, so every surface that reads findings by
          // goal keeps working. The measure is what makes this row its own.
          subjectKeyResultId: measure.id,
          severity: found.severity,
          reason: found.reason,
        });
      }
    }

    // No key results means nothing to diverge from: §3.7's signal would be
    // reading a progress figure with nothing under it.
    const signal =
      confidences.length === 0
        ? null
        : progressSignal(Number(goal.progressPct), input.thresholds);

    const found = divergences(
      {
        health: goal.health,
        signal,
        averageConfidence: averageConfidence(
          confidences.map((row: { confidence: string | null }) =>
            row.confidence === null ? null : Number(row.confidence),
          ),
        ),
      },
      input.thresholds,
    );
    if (found.length === 0) {
      continue;
    }

    // **One finding per goal for §6.1's two cases, the most serious one.** Both
    // say the same thing to a facilitator ("this status disagrees with this
    // goal's own data"), so two rows about one disagreement would need two
    // dismissals for one decision. That is a judgement about the cases, not a
    // limit of the table: the linked-work findings above carry a key result and
    // therefore their own identity, and several of them can sit beside this one
    // on the same goal (P5-T14). These two still cannot, and should not.
    const worst =
      found.find((entry) => entry.severity === "high") ??
      (found[0] as (typeof found)[number]);

    wanted.push({
      // The §6.4 trigger key, not the divergence's own case name. Every message
      // cites a rule the method package defines, and `quality.divergence` is
      // that rule; which case fired is in the reason sentence, where a reader
      // needs it.
      ruleKey: "quality.divergence",
      subjectGoalId: goal.id,
      targetGoalId: null,
      severity: worst.severity,
      reason: worst.reason,
    });
  }

  await reconcileFindingsInTx(tx, {
    workspaceId: input.workspaceId,
    cycleId: input.cycleId,
    scope: "workspace",
    scopeId: null,
    source: "coach",
    kind: "divergence",
    wanted,
  });

  return { examined: open.length, found: wanted.length };
}
