/**
 * The KPIs template (P6-T01a).
 *
 * **The corridor thresholds are optional and the canon defaults stand when the
 * file is silent.** METHOD.md §11 holds the healthy and watch bands, and a
 * source system that carries its own numbers can bring them; one that does not
 * gets the defaults rather than zeros.
 *
 * **A calculated KPI is not importable here.** Its value comes from a formula,
 * and the formula is a token string in the source that has to be translated
 * into an expression tree, which is FlowyTeam's problem in P6-T02 and not a
 * column in a spreadsheet.
 */
import {
  KPI_AGGREGATES,
  KPI_DIRECTION_VALUES,
  KPI_FREQUENCY_VALUES,
  KPI_TIERS,
} from "@openokr/db";
import { asEnum, asNumber, asText } from "./coerce.ts";
import type { EntityTemplate, PlanContext, RowPlan } from "./types.ts";

const INDICATOR_TYPES = ["leading", "lagging"] as const;

export const kpisTemplate: EntityTemplate = {
  entity: "kpis",
  describe: "KPIs, one per row, with their frequency and their corridor.",
  legacyField: "externalId",
  legacyTable: "kpis",
  columns: [
    {
      field: "externalId",
      describe: "The identifier the source system uses for this KPI.",
      aliases: ["externalId", "id", "sourceId", "legacyId", "indicatorId"],
      required: true,
    },
    {
      field: "title",
      describe: "What is being measured.",
      aliases: ["title", "kpi", "indicator", "name", "metric"],
      required: true,
    },
    {
      field: "frequency",
      describe: `How often it is recorded. One of: ${KPI_FREQUENCY_VALUES.join(", ")}.`,
      aliases: ["frequency", "occurrence", "cadence", "period"],
      required: true,
    },
    {
      field: "direction",
      describe: `One of: ${KPI_DIRECTION_VALUES.join(", ")}. Higher is better by default.`,
      aliases: ["direction", "polarity", "better"],
      required: false,
    },
    {
      field: "indicatorType",
      describe: `One of: ${INDICATOR_TYPES.join(", ")}. Lagging by default, and flagged for review.`,
      aliases: ["indicatorType", "type"],
      required: false,
    },
    {
      field: "tier",
      describe: `One of: ${KPI_TIERS.join(", ")}. Output by default.`,
      aliases: ["tier", "layer", "kind"],
      required: false,
    },
    {
      field: "aggregate",
      describe: `How a period's values combine. One of: ${KPI_AGGREGATES.join(", ")}.`,
      aliases: ["aggregate", "aggregation", "rollup"],
      required: false,
    },
    {
      field: "unit",
      describe: "What the numbers are in.",
      aliases: ["unit", "uom"],
      required: false,
    },
    {
      field: "space",
      describe:
        "The space that owns it, by name. Leave it empty for a workspace-level KPI.",
      aliases: ["space", "team", "department"],
      required: false,
    },
    {
      field: "targetDefault",
      describe:
        "The target every period gets when a record does not carry one.",
      aliases: ["targetDefault", "target", "defaultTarget"],
      required: false,
    },
    {
      field: "healthyPct",
      describe:
        "Achievement at or above which the KPI is healthy. The canon default when empty.",
      aliases: ["healthyPct", "healthy", "greenAt"],
      required: false,
    },
    {
      field: "watchPct",
      describe:
        "Achievement at or above which the KPI is on watch. The canon default when empty.",
      aliases: ["watchPct", "watch", "amberAt"],
      required: false,
    },
  ],

  async plan({
    values,
    legacyId,
    existingId,
    references,
  }: PlanContext): Promise<RowPlan> {
    const title = asText("title", values.title ?? "");
    const frequency = asEnum(
      "frequency",
      values.frequency ?? "",
      KPI_FREQUENCY_VALUES,
    );
    const optionalNumber = (field: string): number | undefined =>
      values[field] === undefined || values[field] === ""
        ? undefined
        : asNumber(field, values[field] as string);

    const shared = {
      title,
      ...(values.direction
        ? {
            direction: asEnum(
              "direction",
              values.direction,
              KPI_DIRECTION_VALUES,
            ),
          }
        : {}),
      ...(values.indicatorType
        ? {
            indicatorType: asEnum(
              "indicatorType",
              values.indicatorType,
              INDICATOR_TYPES,
            ),
          }
        : {}),
      ...(values.tier ? { tier: asEnum("tier", values.tier, KPI_TIERS) } : {}),
      ...(values.unit ? { unit: asText("unit", values.unit, 60) } : {}),
      ...(optionalNumber("targetDefault") === undefined
        ? {}
        : { targetDefault: optionalNumber("targetDefault") }),
      ...(optionalNumber("healthyPct") === undefined
        ? {}
        : { healthyPct: optionalNumber("healthyPct") }),
      ...(optionalNumber("watchPct") === undefined
        ? {}
        : { watchPct: optionalNumber("watchPct") }),
    };

    if (existingId) {
      // The frequency is not updated. Changing it re-keys every record the KPI
      // holds, which is a migration rather than an import.
      return {
        kind: "update",
        action: "kpis.update",
        input: { kpiId: existingId, ...shared },
      };
    }

    return {
      kind: "create",
      action: "kpis.create",
      input: {
        ...shared,
        frequency,
        ...(values.aggregate
          ? { aggregate: asEnum("aggregate", values.aggregate, KPI_AGGREGATES) }
          : {}),
        ...(values.space
          ? {
              ownerKind: "space",
              spaceId: await references.space(values.space),
            }
          : { ownerKind: "workspace" }),
        legacy: { type: "csv", id: legacyId },
      },
    };
  },
};
