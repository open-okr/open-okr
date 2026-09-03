/**
 * The KPI records template (P6-T01a).
 *
 * **The one entity with no legacy key, and the reason is that it does not need
 * one.** `kpis.record` is unique per KPI per period and updates rather than
 * duplicating, so importing the same file twice writes each period once
 * whatever identifier the source used. Adding a legacy key would give the row
 * two identities and let the two disagree.
 *
 * The date is any day inside the period. The server normalises it against the
 * KPI's own frequency, which is why a monthly KPI accepts the 3rd and stores
 * the month: a client that normalised would have to know the frequency, and
 * would be a second place the period is decided.
 */
import { asDay, asNumber, asText } from "./coerce.ts";
import type { EntityTemplate, PlanContext, RowPlan } from "./types.ts";

export const kpiRecordsTemplate: EntityTemplate = {
  entity: "kpi-records",
  describe: "KPI values, one row per KPI per period.",
  columns: [
    {
      field: "kpi",
      describe:
        "The KPI, by the identifier the KPI file used, by its short id, or by its id here.",
      aliases: ["kpi", "indicator", "kpiId", "indicatorId", "metric"],
      required: true,
    },
    {
      field: "on",
      describe:
        "Any day inside the period. The period itself is worked out from the KPI's frequency.",
      aliases: ["on", "date", "period", "periodStart", "month"],
      required: true,
    },
    {
      field: "actualValue",
      describe: "What was achieved. Leave it empty to record a target only.",
      aliases: ["actualValue", "actual", "value", "result"],
      required: false,
    },
    {
      field: "targetValue",
      describe: "The target for this period. The KPI's default when empty.",
      aliases: ["targetValue", "target", "plan"],
      required: false,
    },
    {
      field: "remark",
      describe: "A note on the period.",
      aliases: ["remark", "note", "comment", "commentary"],
      required: false,
    },
  ],

  async plan({ values, references }: PlanContext): Promise<RowPlan> {
    const on = asDay("on", values.on ?? "");
    const actualValue =
      values.actualValue === undefined || values.actualValue === ""
        ? undefined
        : asNumber("actualValue", values.actualValue);
    const targetValue =
      values.targetValue === undefined || values.targetValue === ""
        ? undefined
        : asNumber("targetValue", values.targetValue);

    if (actualValue === undefined && targetValue === undefined) {
      throw new Error(
        "A record needs an actual value or a target. This row has neither, so there is nothing to record.",
      );
    }

    return {
      kind: "upsert",
      action: "kpis.record",
      input: {
        kpiId: await references.kpi(values.kpi ?? ""),
        on,
        ...(actualValue === undefined ? {} : { actualValue }),
        ...(targetValue === undefined ? {} : { targetValue }),
        ...(values.remark ? { remark: asText("remark", values.remark) } : {}),
      },
    };
  },
};
