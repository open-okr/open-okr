/**
 * The planning and drafting assists (AI-NATIVE-PLAN.md §2.1, P4-T15a).
 *
 * Three read actions, and reads is the whole point: an assist suggests and a
 * person decides. Nothing here writes, so there is no version of these that
 * quietly creates an objective, and the propose-and-approve line is drawn by the
 * shape of the code rather than by remembering to be careful.
 *
 * **Every one answers null with the provider off, and null is not an error.**
 * The surface offers nothing rather than showing a failure, and the deterministic
 * path is untouched: the Draft Coach evaluates the same rules, the publish gates
 * refuse the same drafts, and the create form works exactly as it did. That is
 * the row's acceptance criterion and it is what `null` here means.
 *
 * **The product judges the model's output; the model does not get to claim it.**
 * `goals.rewriteKeyResult` established this in P4-T06c and these follow it: a
 * drafted objective and a suggested measure are run back through METHOD.md §4's
 * own checks, and the response reports which checks actually pass. A confident
 * draft that fails OBJ-2 is presented as failing OBJ-2.
 */
import { withContext } from "@openokr/db";
import {
  evaluateKeyResults,
  evaluateObjective,
  type KeyResultInput,
} from "@openokr/method";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import type { OperationTx } from "../operations/operation.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";
import { type ActionCallContext, defineReadAction } from "./define.ts";
import { listGoals, readGoal } from "./goals.ts";

/**
 * The two reads these assists build on, called as handlers rather than through
 * `callAction`.
 *
 * **Not a shortcut, and not a way round anything.** A read action's handler *is*
 * what `callAction` invokes, and it carries its own access check, so nothing is
 * skipped. What is avoided is an import cycle: `registry.ts` imports this file,
 * so this file importing `callAction` back left TypeScript unable to infer the
 * registry's own type, and every typed `callAction` result across the package
 * silently became `any`. Thirteen test files started failing on implicit `any`
 * before the cause was obvious.
 */

/**
 * One feature key per assist, so an administrator can turn off the one that is
 * not helping without losing the other two.
 */
export const ASSIST_FEATURE_KEYS = {
  draftObjective: "assists.draftObjective",
  suggestMeasure: "assists.suggestMeasure",
  suggestParent: "assists.suggestParent",
} as const;

/** How many objectives an assist may look at, or offer as parents. */
const CANDIDATE_LIMIT = 40;

/**
 * Whether this assist may run: a provider that can do it, its own switch on,
 * and the budget not spent.
 *
 * Returns false rather than throwing. An assist that is off is not a failure and
 * the surface says nothing about it.
 */
async function assistAllowed(
  context: ActionCallContext,
  featureKey: string,
): Promise<boolean> {
  const availability = await checkFeatureAvailability(context.pool, {
    workspaceId: context.workspaceId,
    featureKey,
    defaultTier: "balanced",
  });
  return availability.available;
}

const draftedKeyResult = z.object({
  title: z.string(),
  unit: z.string().nullable(),
  direction: z.enum(["increase", "reduce", "maintain", "move"]),
  indicatorType: z.enum(["leading", "lagging"]),
  baseline: z.number(),
  target: z.number(),
  /** The §4 checks this measure passes as drafted, by their own ids. */
  passing: z.array(z.string()),
  /** The checks it fails, so the reader is not told it is fine when it is not. */
  failing: z.array(z.string()),
});

/**
 * Drafts an objective and its key results from an ambition.
 *
 * The verdicts travel with the draft. A reader is shown "this passes OBJ-1 and
 * OBJ-3, and fails OBJ-2 because it has no number in it" from the catalogue,
 * rather than a draft with a confident sentence attached.
 */
export const draftObjective = defineReadAction({
  name: "goals.draftObjective",
  summary:
    "Drafts an objective and its key results from a plain-language ambition, with the quality checks it passes.",
  input: z.object({
    ambition: z.string().trim().min(1).max(2000),
    cycleId: z.uuid(),
    spaceId: z.uuid().optional(),
    /** The level the draft is for, which decides which §4 rules apply. */
    level: z.enum(["company", "department", "team", "individual"]),
  }),
  output: z
    .object({
      title: z.string(),
      description: z.string(),
      keyResults: z.array(draftedKeyResult),
      /** The objective's own §4 verdicts. */
      passing: z.array(z.string()),
      failing: z.array(z.string()),
    })
    .nullable(),
  access: ACCESS_LEVELS.edit,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.draftObjective) {
      return null;
    }
    if (!(await assistAllowed(context, ASSIST_FEATURE_KEYS.draftObjective))) {
      return null;
    }

    // What is already in the cycle, so a draft does not restate one. Read
    // through the registry, so it is what this member may see and nothing else.
    const existing = (
      await listGoals.handler(context, {
        cycleId: input.cycleId,
        includeClosed: false,
      })
    ).goals;
    const existingTitles = existing
      .slice(0, CANDIDATE_LIMIT)
      .map((goal) => goal.title);

    let drafted: Awaited<
      ReturnType<NonNullable<typeof drafter.draftObjective>>
    >;
    try {
      drafted = await drafter.draftObjective({
        ambition: input.ambition,
        spaceName: null,
        existingTitles,
      });
    } catch {
      // A model having a bad minute leaves the form exactly as it was.
      return null;
    }
    if (!drafted || drafted.title.trim() === "") {
      return null;
    }

    const thresholds = await thresholdsFor(context);
    // §4 over the model's own output, from the catalogue rather than from the
    // model. A draft that fails a rule says so.
    const objectiveVerdicts = evaluateObjective(
      {
        title: drafted.title,
        hasCycle: true,
        hasTimeframe: false,
        // A drafted objective is not owned yet: whoever applies it becomes its
        // champion, and the ownership rules are evaluated then. Reported as
        // failing here would be reporting a fault in the form rather than in
        // the draft.
        championId: "pending",
        reviewerId: "pending",
        objectivesInUnit: existing.length + 1,
        level: input.level,
      },
      thresholds,
    );

    const asInput = (
      measure: (typeof drafted.keyResults)[number],
    ): KeyResultInput => ({
      text: measure.title,
      baseline: measure.baseline,
      target: measure.target,
      dueOn: null,
      ownerId: null,
      indicatorType: measure.indicatorType,
      direction: measure.direction,
      confidence: null,
    });
    const measureVerdicts = evaluateKeyResults(
      { keyResults: drafted.keyResults.map(asInput) },
      thresholds,
    );

    return {
      title: drafted.title,
      description: drafted.description,
      keyResults: drafted.keyResults.map((measure, index) => {
        // `keyResults` on a verdict names which measures tripped it, and is
        // empty on a set-level check and on anything that passed. So a verdict
        // belongs to this measure when it names it, and a passing verdict
        // belongs to all of them.
        const mine = measureVerdicts.filter(
          (verdict) =>
            verdict.keyResults.length === 0 ||
            verdict.keyResults.includes(index),
        );
        return {
          title: measure.title,
          unit: measure.unit,
          direction: measure.direction,
          indicatorType: measure.indicatorType,
          baseline: measure.baseline,
          target: measure.target,
          passing: mine
            .filter((verdict: { status: string }) => verdict.status === "pass")
            .map((verdict: { id: string }) => verdict.id),
          failing: mine
            .filter((verdict: { status: string }) => verdict.status !== "pass")
            .map((verdict: { id: string }) => verdict.id),
        };
      }),
      passing: objectiveVerdicts
        .filter((verdict) => verdict.status === "pass")
        .map((verdict) => verdict.id),
      failing: objectiveVerdicts
        .filter((verdict) => verdict.status !== "pass")
        .map((verdict) => verdict.id),
    };
  },
});

/** The workspace's own resolved thresholds, so the browser and the server agree. */
async function thresholdsFor(context: ActionCallContext) {
  const db = drizzle(context.pool);
  const userId = context.actor.userId;
  return withContext(
    db,
    { workspaceId: context.workspaceId, userId: userId ?? "" },
    async (rawTx) => {
      const tx = rawTx as unknown as OperationTx;
      return resolveRhythm(await readRhythmRow(tx, context.workspaceId))
        .thresholds;
    },
  );
}

/** Suggests the numbers a key result needs, and reports what they pass. */
export const suggestMeasure = defineReadAction({
  name: "goals.suggestMeasure",
  summary:
    "Suggests a unit, a direction, a baseline and a target for a key result, with the checks they pass.",
  input: z.object({
    goalId: z.uuid(),
    /** The sentence somebody has typed so far. */
    title: z.string().trim().min(1).max(500),
    unit: z.string().trim().max(60).optional(),
  }),
  output: z
    .object({
      unit: z.string().nullable(),
      direction: z.enum(["increase", "reduce", "maintain", "move"]),
      indicatorType: z.enum(["leading", "lagging"]),
      baseline: z.number(),
      target: z.number(),
      passing: z.array(z.string()),
      failing: z.array(z.string()),
    })
    .nullable(),
  access: ACCESS_LEVELS.edit,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.suggestMeasure) {
      return null;
    }
    if (!(await assistAllowed(context, ASSIST_FEATURE_KEYS.suggestMeasure))) {
      return null;
    }

    // Through the registry, so a goal this member cannot read answers not-found
    // before a model is asked anything about it.
    const goal = await readGoal.handler(context, { id: input.goalId });

    let suggestion: Awaited<
      ReturnType<NonNullable<typeof drafter.suggestMeasure>>
    >;
    try {
      suggestion = await drafter.suggestMeasure({
        keyResultTitle: input.title,
        goalTitle: goal.title,
        unit: input.unit ?? null,
      });
    } catch {
      return null;
    }
    if (!suggestion) {
      return null;
    }

    const thresholds = await thresholdsFor(context);
    const verdicts = evaluateKeyResults(
      {
        keyResults: [
          {
            text: input.title,
            baseline: suggestion.baseline,
            target: suggestion.target,
            dueOn: null,
            ownerId: null,
            indicatorType: suggestion.indicatorType,
            direction: suggestion.direction,
            confidence: null,
          },
        ],
      },
      thresholds,
    );

    return {
      unit: suggestion.unit,
      direction: suggestion.direction,
      indicatorType: suggestion.indicatorType,
      baseline: suggestion.baseline,
      target: suggestion.target,
      passing: verdicts
        .filter((verdict: { status: string }) => verdict.status === "pass")
        .map((verdict: { id: string }) => verdict.id),
      failing: verdicts
        .filter((verdict: { status: string }) => verdict.status !== "pass")
        .map((verdict: { id: string }) => verdict.id),
    };
  },
});

/**
 * Suggests the objective this one should align to.
 *
 * **Safe by construction, not by filtering afterwards.** The candidates come
 * from `goals.list`, which is access-scoped, and the model answers with an index
 * into that list. So there is no index it could return that resolves to a goal
 * this member cannot read, and no filter to forget.
 */
export const suggestParent = defineReadAction({
  name: "goals.suggestParent",
  summary:
    "Suggests which objective this one should align to, from the ones the reader may see.",
  input: z.object({ goalId: z.uuid() }),
  output: z
    .object({
      parentGoalId: z.uuid(),
      parentTitle: z.string(),
      reason: z.string(),
    })
    .nullable(),
  access: ACCESS_LEVELS.edit,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.suggestParent) {
      return null;
    }
    if (!(await assistAllowed(context, ASSIST_FEATURE_KEYS.suggestParent))) {
      return null;
    }

    const child = await readGoal.handler(context, { id: input.goalId });
    const all = (await listGoals.handler(context, { includeClosed: false }))
      .goals;
    const candidates = all
      .filter(
        (goal) =>
          goal.id !== input.goalId &&
          // A parent is above the child, which is what alignment means. A team
          // objective under another team objective is a dependency, not a
          // parent, and §5 has its own register for that.
          levelRank(goal.level) < levelRank(child.level),
      )
      .slice(0, CANDIDATE_LIMIT);
    if (candidates.length === 0) {
      return null;
    }

    let suggested: Awaited<
      ReturnType<NonNullable<typeof drafter.suggestParent>>
    >;
    try {
      suggested = await drafter.suggestParent({
        childTitle: child.title,
        childDescription: descriptionOf(child.description),
        candidates: candidates.map((goal) => ({
          title: goal.title,
          level: goal.level,
        })),
      });
    } catch {
      return null;
    }
    if (!suggested) {
      return null;
    }

    const index = suggested.candidateIndex;
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
      // The model miscounted. There is nothing to resolve it to, which is the
      // whole reason the answer is positional.
      return null;
    }
    const parent = candidates[index];
    if (!parent) {
      return null;
    }

    return {
      parentGoalId: parent.id,
      parentTitle: parent.title,
      reason: suggested.reason,
    };
  },
});

const LEVELS = ["company", "department", "team", "individual"] as const;

const levelRank = (level: string) => {
  const at = (LEVELS as readonly string[]).indexOf(level);
  return at < 0 ? LEVELS.length : at;
};

/** Plain text from an editor document, through the one shared module. */
const descriptionOf = (description: unknown): string =>
  description === null || description === undefined
    ? ""
    : excerptRichText(description as never, 800);
