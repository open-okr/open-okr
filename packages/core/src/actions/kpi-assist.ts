/**
 * KPIs, thresholds and formulas suggested from plain language
 * (AI-NATIVE-PLAN.md §2.2, P4-T15b-b).
 *
 * A read, so nothing is created: a suggestion is offered and a person decides.
 *
 * **The formula is validated by §6's own parser before it is offered.** A model
 * that writes a formula referring to a metric that is not there, or nests one
 * deeper than §6 allows, has produced something the product would refuse at
 * `kpis.setFormula` anyway. Refusing it here means the reader never sees a
 * suggestion they cannot apply. The rest of the suggestion stands when the
 * formula is dropped, because a metric with a bad formula is still a metric
 * somebody wanted.
 *
 * **The model refers to existing metrics by number, never by identifier**, the
 * same rule as the citations, the parent suggestion and the filter. So a
 * suggested formula can only reference metrics this member can already read.
 */
import {
  KPI_DIRECTION_VALUES,
  KPI_FREQUENCY_VALUES,
  KPI_TIERS,
} from "@openokr/db";
import { type FormulaNode, validateFormula } from "@openokr/method";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { RHYTHM_ASSIST_KEYS } from "../ai/assist-keys.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { defineReadAction } from "./define.ts";
import { readKpiGrid } from "./kpis.ts";

/** How many existing metrics the model is offered as formula references. */
const REFERENCE_LIMIT = 30;

/** §6's own corridor bounds, as `kpis.create` states them. */
const CORRIDOR_MIN = 0;
const CORRIDOR_MAX = 200;

/**
 * §6's four operators, in §6's own spelling.
 *
 * Not "sum" or "ratio": `formulaNodeSchema` names them `add`, `sub`, `mul` and
 * `div`, and a second vocabulary for the same four things is a translation layer
 * that eventually disagrees with the parser.
 */
const OPERATIONS = ["add", "sub", "mul", "div"] as const;

const suggestionOutput = z.object({
  title: z.string(),
  unit: z.string().nullable(),
  frequency: z.enum(KPI_FREQUENCY_VALUES),
  direction: z.enum(KPI_DIRECTION_VALUES),
  tier: z.enum(KPI_TIERS),
  targetDefault: z.number().nullable(),
  healthyPct: z.number().nullable(),
  watchPct: z.number().nullable(),
  /**
   * The formula, as `kpis.setFormula` takes it, or null.
   *
   * Null covers both "the sentence described a metric somebody records by hand"
   * and "the model wrote a formula §6 refuses". The reader is told which.
   */
  formula: z.unknown().nullable(),
  /** Which existing metrics it combines, for the preview. */
  formulaReferences: z.array(z.string()),
  /** Why the formula was dropped, when it was. Null otherwise. */
  formulaRefused: z.string().nullable(),
  why: z.string(),
});

/**
 * Suggests a metric from a sentence.
 *
 * Every field is checked against the grammar it belongs to before it is offered.
 * A frequency the product does not have, a corridor outside §6's bounds, or a
 * formula the parser refuses are each dropped on their own rather than taking the
 * whole suggestion down: a title and a unit are useful even when the numbers need
 * a person.
 */
export const suggestKpi = defineReadAction({
  name: "kpis.suggest",
  summary:
    "Suggests a metric, its corridor and its formula from a sentence, with §6's parser checking the formula first.",
  input: z.object({
    description: z.string().trim().min(1).max(1000),
  }),
  output: suggestionOutput.nullable(),
  access: ACCESS_LEVELS.edit,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.suggestKpi) {
      return null;
    }
    const availability = await checkFeatureAvailability(context.pool, {
      workspaceId: context.workspaceId,
      featureKey: RHYTHM_ASSIST_KEYS.suggestKpi,
      defaultTier: "balanced",
    });
    if (!availability.available) {
      return null;
    }

    // Through the registry's own read, so the metrics offered as references are
    // the ones this member may see.
    const grid = await readKpiGrid.handler(context, { periods: 1 });
    const existing = grid.kpis.slice(0, REFERENCE_LIMIT);

    let suggested: Awaited<ReturnType<NonNullable<typeof drafter.suggestKpi>>>;
    try {
      suggested = await drafter.suggestKpi({
        description: input.description,
        existing: existing.map((kpi) => kpi.title),
      });
    } catch {
      return null;
    }
    if (!suggested || suggested.title.trim() === "") {
      return null;
    }

    // Each enum on its own, so one bad field does not lose the rest.
    const frequency = (KPI_FREQUENCY_VALUES as readonly string[]).includes(
      suggested.frequency,
    )
      ? (suggested.frequency as (typeof KPI_FREQUENCY_VALUES)[number])
      : "monthly";
    const direction = (KPI_DIRECTION_VALUES as readonly string[]).includes(
      suggested.direction,
    )
      ? (suggested.direction as (typeof KPI_DIRECTION_VALUES)[number])
      : "higher_better";
    const tier = (KPI_TIERS as readonly string[]).includes(
      suggested.indicatorType,
    )
      ? (suggested.indicatorType as (typeof KPI_TIERS)[number])
      : "output";

    const corridor = (value: number | null): number | null =>
      value === null ||
      !Number.isFinite(value) ||
      value < CORRIDOR_MIN ||
      value > CORRIDOR_MAX
        ? null
        : value;

    const { formula, formulaRefused } = buildFormula(
      suggested.formula,
      existing.map((kpi) => kpi.id),
    );

    return {
      title: suggested.title.trim(),
      unit: suggested.unit === null ? null : suggested.unit.trim() || null,
      frequency,
      direction,
      tier,
      targetDefault: Number.isFinite(suggested.targetDefault ?? Number.NaN)
        ? (suggested.targetDefault as number)
        : null,
      healthyPct: corridor(suggested.healthyPct ?? null),
      watchPct: corridor(suggested.watchPct ?? null),
      formula,
      formulaRefused,
      formulaReferences:
        formula === null
          ? []
          : validateFormula(formula)
              .references.map(
                (id) => existing.find((kpi) => kpi.id === id)?.title ?? "",
              )
              .filter((title) => title !== ""),
      why: suggested.why.trim(),
    };
  },
});

/**
 * Turns the model's numbered references into a §6 formula node, or refuses it.
 *
 * Two checks, and the second is the one that matters. The indexes are resolved
 * against the list the model was shown, so a number past the end cannot become a
 * reference to somebody else's metric. Then §6's own `validateFormula` decides
 * whether what was built is a formula at all, which is the check
 * `kpis.setFormula` would apply later: applying it now means a reader is never
 * offered a suggestion the product would go on to refuse.
 *
 * **The tree is folded left, because §6's operators are binary.**
 * `formulaNodeSchema` has one operator with a left and a right, so three
 * references under `add` become `(a + b) + c`. That is the same arithmetic for
 * add and mul, and for sub and div it is the reading anybody writing
 * "a - b - c" means.
 */
export function buildFormula(
  suggested: { operation: string; references: readonly number[] } | null,
  ids: readonly string[],
): { formula: FormulaNode | null; formulaRefused: string | null } {
  if (!suggested) {
    return { formula: null, formulaRefused: null };
  }
  if (!(OPERATIONS as readonly string[]).includes(suggested.operation)) {
    return {
      formula: null,
      formulaRefused: `"${suggested.operation}" is not arithmetic this product does.`,
    };
  }

  const referenced: string[] = [];
  for (const index of suggested.references) {
    if (!Number.isInteger(index) || index < 1 || index > ids.length) {
      return {
        formula: null,
        formulaRefused: "It referred to a metric that is not there.",
      };
    }
    const id = ids[index - 1];
    if (id) {
      referenced.push(id);
    }
  }
  if (referenced.length < 2) {
    return {
      formula: null,
      formulaRefused: "A formula needs at least two metrics to combine.",
    };
  }

  const operation = suggested.operation as (typeof OPERATIONS)[number];
  let node: FormulaNode = { k: referenced[0] as string };
  for (const id of referenced.slice(1)) {
    node = { op: operation, l: node, r: { k: id } };
  }

  const shape = validateFormula(node);
  if (!shape.ok) {
    // §6's own parser, and its own words for what is wrong. A suggestion the
    // product would refuse later is refused now.
    return {
      formula: null,
      formulaRefused:
        shape.problem === null
          ? "That is not a formula this product can evaluate."
          : `That formula is not valid: ${String(shape.problem).replace(/_/g, " ")}.`,
    };
  }

  return { formula: node, formulaRefused: null };
}
