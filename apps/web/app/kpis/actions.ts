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
  revalidatePath("/kpis");
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

export async function addKpi(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const title = String(formData.get("title") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "monthly");
  const direction = String(formData.get("direction") ?? "higher_better");
  const targetRaw = String(formData.get("targetDefault") ?? "").trim();
  if (title === "") {
    const { t } = await getTranslations();
    return { error: t("kpis.actions.kpiNeedsATitle") };
  }
  const target = Number(targetRaw);
  return run((context) =>
    callAction(context, "kpis.create", {
      title,
      frequency: frequency as
        | "daily"
        | "weekly"
        | "monthly"
        | "quarterly"
        | "yearly",
      direction: direction as "higher_better" | "lower_better",
      // Every field with a schema default has to be named: callAction types on
      // the schema output, so a default is a value the caller still states.
      indicatorType: "lagging",
      tier: "output",
      aggregate: "sum",
      ownerKind: "workspace",
      ...(targetRaw !== "" && Number.isFinite(target)
        ? { targetDefault: target }
        : {}),
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
