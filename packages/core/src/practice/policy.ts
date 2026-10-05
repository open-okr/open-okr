/**
 * `requirePolicy`: the one way an action asks whether the practice allows a
 * write (P9-T02, design §2.2).
 *
 * `decide` in packages/method answers the question. This module gathers what
 * it needs inside the caller's transaction: the workspace's practice and
 * thresholds, the cycle, today in the workspace's timezone, and the phases,
 * which are read only when the practice makes drafting wait for them, because
 * evaluating a cycle's workflow is a dozen queries nobody needs otherwise.
 *
 * A refusal is an `OperationError("forbidden")` carrying the policy's
 * sentences, so the screen, the REST surface, the command line and an agent
 * all read the same reason. The source test `policy-gate.test.ts` fails the
 * build when an OKR write action neither calls this nor says in writing why
 * it need not, which is what keeps the next lock from being added in one
 * place only.
 */
import type { WorkspaceTx } from "@openokr/db";
import {
  type CycleFacts,
  decide,
  levelsInUse,
  OKR_LEVELS,
  type PolicyDecision,
  policyNeedsPhases,
} from "@openokr/method";
import { formatLocalDate, localDateIn } from "../cycles/generation.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow, workspaceTimeZone } from "../cycles/service.ts";
import { evaluateWorkflow, loadCycleForWorkflow } from "../cycles/workflow.ts";
import { OperationError } from "../operations/operation.ts";
import { cycleLevelsInTx } from "./levels.ts";
import { practiceFromRow } from "./settings.ts";

/** A write the practice governs, named by what it touches. */
export type PolicyRequest =
  | {
      readonly kind: "objective.create";
      readonly cycleId: string | null;
      /** Whether it names a reviewer (P9-T04). */
      readonly hasReviewer?: boolean;
      /** The level it is written at, judged against the levels in use (P9-T07a-c). */
      readonly level?: string;
    }
  /** Taking the reviewer off an objective (P9-T04). */
  | { readonly kind: "reviewer.remove" }
  | { readonly kind: "keyResult.create"; readonly cycleId: string | null }
  /** Publishing a set, or its company half (P9-T03b). */
  | { readonly kind: "set.publish"; readonly cycleId: string }
  /** Changing a key result's target (P9-T06b). Needs no cycle. */
  | {
      readonly kind: "target.change";
      readonly from: number;
      readonly to: number;
      readonly baseline: number;
      readonly hasReason: boolean;
    };

/**
 * What the policy decides for this request, without refusing.
 *
 * For a surface that shows the decision rather than acting on it, such as the
 * cycle screen saying whether drafting is open.
 */
export async function policyDecisionInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  workspaceId: string,
  request: PolicyRequest,
): Promise<PolicyDecision> {
  const row = await readRhythmRow(tx, workspaceId);
  const { practice } = practiceFromRow(row);
  const { thresholds } = resolveRhythm(row);
  if (request.kind === "reviewer.remove") {
    return decide({ kind: "reviewer.remove" }, practice, thresholds);
  }
  if (request.kind === "target.change") {
    return decide(request, practice, thresholds);
  }

  let cycle: CycleFacts | null = null;
  if (request.cycleId !== null) {
    const loaded = await loadCycleForWorkflow(tx, workspaceId, request.cycleId);
    // An unknown cycle is not the policy's to refuse: the write that names
    // it refuses it as not found, with its own sentence.
    if (loaded) {
      const today = formatLocalDate(
        localDateIn(new Date(), await workspaceTimeZone(tx, workspaceId)),
      );
      const facts: CycleFacts = {
        mode: loaded.mode,
        startsOn: loaded.startsOn,
        today,
      };
      cycle = policyNeedsPhases(
        request.kind === "set.publish"
          ? { kind: "set.publish", cycle: facts }
          : { kind: request.kind, cycle: facts },
        practice,
      )
        ? {
            ...facts,
            phases: (
              await evaluateWorkflow(tx, workspaceId, loaded, thresholds)
            ).phases,
          }
        : facts;
    }
  }

  if (request.kind === "set.publish") {
    // A publish names a cycle that exists, or the action has already refused
    // it as not found; with no cycle there is nothing for the policy to hold.
    return cycle === null
      ? { outcome: "allow", rules: [], reasons: [] }
      : decide({ kind: "set.publish", cycle }, practice, thresholds);
  }
  if (request.kind === "objective.create") {
    // §2.7: the cycle's own levels, or today's for an objective with its own
    // timeframe, which is in no cycle to have begun with any.
    const level = OKR_LEVELS.find((entry) => entry === request.level);
    const levels =
      level === undefined
        ? undefined
        : request.cycleId === null
          ? levelsInUse(practice)
          : await cycleLevelsInTx(tx, workspaceId, request.cycleId);
    return decide(
      {
        kind: "objective.create",
        cycle,
        ...(request.hasReviewer === undefined
          ? {}
          : { hasReviewer: request.hasReviewer }),
        ...(level === undefined || levels === undefined
          ? {}
          : { level, levelsInUse: levels }),
      },
      practice,
      thresholds,
    );
  }
  return decide({ kind: request.kind, cycle }, practice, thresholds);
}

/**
 * Refuses the write with the policy's reasons when the practice blocks it.
 *
 * **An import is not refused.** `bulk` is set by the two importers and by
 * nothing else, and an import records objectives somebody already wrote,
 * often in cycles long closed. Refusing history because this workspace now
 * plans in a window would lose it, which no setting may do (design §2.5).
 */
export async function requirePolicy<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  call: { readonly workspaceId: string; readonly bulk?: boolean },
  request: PolicyRequest,
): Promise<PolicyDecision> {
  if (call.bulk) {
    return { outcome: "allow", rules: [], reasons: [] };
  }
  const decision = await policyDecisionInTx(tx, call.workspaceId, request);
  if (decision.outcome === "block") {
    throw new OperationError("forbidden", decision.reasons.join(" "));
  }
  return decision;
}
