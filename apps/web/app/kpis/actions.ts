"use server";

/**
 * The KPI grid's writes (S-20, P3-T12).
 *
 * One cell at a time. The period is normalised on the server from the column's
 * own period start, so a client cannot decide which bucket a value lands in.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { assistContext } from "../../lib/assists";
import { getPool } from "../../lib/auth";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

async function run(
  fn: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  try {
    await fn({
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  // The layout, so a KPI's own page is fresh too after it is edited there.
  revalidatePath("/kpis", "layout");
  return NO_ERROR;
}

export async function recordCell(
  kpiId: string,
  periodStart: string,
  actualValue: number | null,
): Promise<WriteState> {
  if (actualValue !== null && !Number.isFinite(actualValue)) {
    const { t } = await getTranslations();
    return { error: t("kpis.actions.valueHasToBeANumberOrEmpty") };
  }
  return run((context) =>
    callAction(context, "kpis.record", {
      kpiId,
      // The column's own period start. Normalising it again is a no-op, and it
      // is what stops a client naming a period the frequency does not have.
      on: periodStart,
      actualValue,
    }),
  );
}

const TARGET_TYPES = [
  "at_least",
  "at_most",
  "increase_to",
  "decrease_to",
  "range",
] as const;
const TIERS = ["input", "output", "outcome", "impact"] as const;

/** A number field, or null when it was left blank or is not a number. */
function numberField(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? "").trim();
  if (raw === "") {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * The rule `JudgedBy` posts, as `kpis.create` and `kpis.update` take it
 * (METHOD.md §6.2, P9-T17b-b). A one-sided green and red value become the
 * pair the type uses; the action refuses a rule it cannot judge by, in words.
 */
function kpiRuleFrom(formData: FormData) {
  const raw = String(formData.get("targetType") ?? "at_least");
  const targetType = (TARGET_TYPES as readonly string[]).includes(raw)
    ? (raw as (typeof TARGET_TYPES)[number])
    : "at_least";
  if (targetType === "range") {
    return {
      targetType,
      greenLow: numberField(formData, "bandLow"),
      greenHigh: numberField(formData, "bandHigh"),
      redLow: numberField(formData, "redBelow"),
      redHigh: numberField(formData, "redAbove"),
    };
  }
  const green = numberField(formData, "green");
  const red = numberField(formData, "red");
  const lowIsGood = targetType === "at_most" || targetType === "decrease_to";
  return {
    targetType,
    greenLow: lowIsGood ? null : green,
    greenHigh: lowIsGood ? green : null,
    redLow: lowIsGood ? null : red,
    redHigh: lowIsGood ? red : null,
  };
}

/** The owner and tier fields, as the action takes them. Blank is none. */
function ownerAndTier(formData: FormData) {
  const owner = String(formData.get("ownerMemberId") ?? "").trim();
  const tier = String(formData.get("tier") ?? "").trim();
  return {
    ownerMemberId: owner === "" ? null : owner,
    tier: (TIERS as readonly string[]).includes(tier)
      ? (tier as (typeof TIERS)[number])
      : null,
  };
}

export async function addKpi(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const title = String(formData.get("title") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "monthly");
  const target = numberField(formData, "targetDefault");
  const unit = String(formData.get("unit") ?? "").trim();
  if (title === "") {
    const { t } = await getTranslations();
    return { error: t("kpis.actions.kpiNeedsATitle") };
  }
  return run((context) =>
    callAction(context, "kpis.create", {
      title,
      frequency: frequency as
        | "daily"
        | "weekly"
        | "monthly"
        | "quarterly"
        | "yearly",
      // Every field with a schema default has to be named: callAction types on
      // the schema output, so a default is a value the caller still states.
      indicatorType: "lagging",
      aggregate: "sum",
      ownerKind: "workspace",
      ...kpiRuleFrom(formData),
      ...ownerAndTier(formData),
      ...(target === null ? {} : { targetDefault: target }),
      ...(unit === "" ? {} : { unit }),
    }),
  );
}

/**
 * How a KPI is judged, who owns it and its tier, from the KPI page
 * (METHOD.md §6.2, P9-T17b-b).
 */
export async function updateKpiRule(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const kpiId = String(formData.get("kpiId") ?? "");
  return run((context) =>
    callAction(context, "kpis.update", {
      kpiId,
      ...kpiRuleFrom(formData),
      ...ownerAndTier(formData),
    }),
  );
}

/**
 * §2.2's KPI suggestion from a sentence, or null (completeness review M-09).
 *
 * A read that writes nothing. Every field has already been checked against
 * its own grammar by the action, and a formula §6's parser refuses comes back
 * as null with the reason beside it.
 */
export async function suggestKpiAction(description: string) {
  return callAction(await assistContext(), "kpis.suggest", { description });
}

/** A suggestion as the person left it after editing. */
export interface KeptKpi {
  readonly title: string;
  readonly unit: string;
  readonly frequency: "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
  readonly direction: "higher_better" | "lower_better";
  readonly tier: "input" | "output" | "outcome" | "impact";
  readonly targetDefault: number | null;
  readonly healthyPct: number | null;
  readonly watchPct: number | null;
  /** The formula the action validated, when the person kept it. */
  readonly formula: unknown;
}

/**
 * Creates the KPI a person kept from a suggestion.
 *
 * The ordinary `kpis.create`, then `kpis.setFormula` when they kept the
 * formula, both as the person pressing the button. The formula is the tree
 * the action already validated with §6's parser, and `kpis.setFormula`
 * validates it again, because a value that crossed the browser is input.
 */
export async function addSuggestedKpiAction(
  kept: KeptKpi,
): Promise<WriteState> {
  const { t } = await getTranslations();
  const title = kept.title.trim();
  if (title === "") {
    return { error: t("kpis.actions.kpiNeedsATitle") };
  }
  const number = (value: number | null) =>
    value !== null && Number.isFinite(value) ? value : undefined;
  const targetDefault = number(kept.targetDefault);
  const healthyPct = number(kept.healthyPct);
  const watchPct = number(kept.watchPct);
  const unit = kept.unit.trim();

  return run(async (context) => {
    const created = await callAction(context, "kpis.create", {
      title,
      frequency: kept.frequency,
      direction: kept.direction,
      // The tier the trees name for something a team can act on this week is
      // input, and input is what a leading indicator measures.
      indicatorType: kept.tier === "input" ? "leading" : "lagging",
      tier: kept.tier,
      aggregate: "sum",
      ownerKind: "workspace",
      ...(unit === "" ? {} : { unit }),
      ...(targetDefault === undefined ? {} : { targetDefault }),
      ...(healthyPct === undefined ? {} : { healthyPct }),
      ...(watchPct === undefined ? {} : { watchPct }),
    });
    if (kept.formula !== null && kept.formula !== undefined) {
      const settings = await callAction(context, "settings.readForMember", {});
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: String(settings.settings.timezone ?? "UTC"),
      }).format(new Date());
      await callAction(context, "kpis.setFormula", {
        kpiId: created.id,
        formula: kept.formula,
        on: today,
      });
    }
  });
}

export async function addCategory(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const name = String(formData.get("name") ?? "").trim();
  if (name === "") {
    const { t } = await getTranslations();
    return { error: t("kpis.actions.categoryNeedsAName") };
  }
  return run((context) => callAction(context, "kpis.createCategory", { name }));
}
