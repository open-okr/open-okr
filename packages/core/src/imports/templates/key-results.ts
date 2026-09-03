/**
 * The key results template (P6-T01a).
 *
 * **The baseline and the target are required and the current value is not.** A
 * measure with no baseline has no progress to compute, and a measure with no
 * target is not a measure. The current value defaults to the baseline, which is
 * what a key result created in the product does, and the create records it as
 * the first point of history.
 *
 * **A row names its goal by the identifier the goals file used.** That is what
 * makes the two files a pair: import the objectives, then the measures, and the
 * second finds the first by the source system's own identifiers rather than by
 * matching titles.
 */
import { INDICATOR_TYPES, KEY_RESULT_DIRECTIONS } from "@openokr/db";
import { asDay, asEnum, asNumber, asText } from "./coerce.ts";
import type { EntityTemplate, PlanContext, RowPlan } from "./types.ts";

export const keyResultsTemplate: EntityTemplate = {
  entity: "key-results",
  describe: "Key results, one per row, each against an objective.",
  legacyField: "externalId",
  legacyTable: "keyResults",
  columns: [
    {
      field: "externalId",
      describe: "The identifier the source system uses for this key result.",
      aliases: ["externalId", "id", "sourceId", "legacyId", "keyResultId"],
      required: true,
    },
    {
      field: "goal",
      describe:
        "The objective it measures, by the identifier the goals file used or by its id here.",
      aliases: ["goal", "objective", "goalId", "objectiveId", "parent"],
      required: true,
    },
    {
      field: "title",
      describe: "The measure itself.",
      aliases: ["title", "keyResult", "measure", "name"],
      required: true,
    },
    {
      field: "direction",
      describe: `One of: ${KEY_RESULT_DIRECTIONS.join(", ")}.`,
      aliases: ["direction", "movement"],
      required: true,
    },
    {
      field: "indicatorType",
      describe: `One of: ${INDICATOR_TYPES.join(", ")}. Lagging by default.`,
      aliases: ["indicatorType", "indicator", "type"],
      required: false,
    },
    {
      field: "unit",
      describe: "What the numbers are in, such as % or customers.",
      aliases: ["unit", "measureUnit", "uom"],
      required: false,
    },
    {
      field: "baselineValue",
      describe: "Where it started.",
      aliases: ["baselineValue", "baseline", "startValue", "from"],
      required: true,
    },
    {
      field: "targetValue",
      describe: "Where it has to reach.",
      aliases: ["targetValue", "target", "goalValue", "to"],
      required: true,
    },
    {
      field: "currentValue",
      describe: "Where it is now. The baseline, if the file does not say.",
      aliases: ["currentValue", "current", "actual", "latest"],
      required: false,
    },
    {
      field: "dueOn",
      describe: "The day it is measured to.",
      aliases: ["dueOn", "dueDate", "due", "deadline"],
      required: false,
    },
    {
      field: "owner",
      describe: "The member who owns the measure, by email address.",
      aliases: ["owner", "champion", "responsible"],
      required: false,
    },
    {
      field: "weight",
      describe: "How much of the objective it carries. One by default.",
      aliases: ["weight", "contribution"],
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
    const direction = asEnum(
      "direction",
      values.direction ?? "",
      KEY_RESULT_DIRECTIONS,
    );
    const indicatorType = values.indicatorType
      ? asEnum("indicatorType", values.indicatorType, INDICATOR_TYPES)
      : "lagging";
    const baselineValue = asNumber("baselineValue", values.baselineValue ?? "");
    const targetValue = asNumber("targetValue", values.targetValue ?? "");
    const currentValue =
      values.currentValue === undefined || values.currentValue === ""
        ? undefined
        : asNumber("currentValue", values.currentValue);
    const weight =
      values.weight === undefined || values.weight === ""
        ? undefined
        : asNumber("weight", values.weight);
    const dueOn = values.dueOn ? asDay("dueOn", values.dueOn) : undefined;
    const ownerId = values.owner
      ? await references.member(values.owner)
      : undefined;

    const shared = {
      title,
      direction,
      indicatorType,
      baselineValue,
      targetValue,
      ...(values.unit ? { unit: asText("unit", values.unit, 60) } : {}),
      ...(dueOn ? { dueOn } : {}),
      ...(ownerId ? { ownerId } : {}),
      ...(weight === undefined ? {} : { weight }),
    };

    if (existingId) {
      // The current value is not updated here. A measure's value is history,
      // and history is written by `goals.recordValue`: overwriting it from a
      // re-run of the definitions file would silently rewrite a check-in.
      return {
        kind: "update",
        action: "goals.updateKeyResult",
        input: { id: existingId, ...shared },
      };
    }

    return {
      kind: "create",
      action: "goals.addKeyResult",
      input: {
        goalId: await references.goal(values.goal ?? ""),
        ...shared,
        ...(currentValue === undefined ? {} : { currentValue }),
        legacy: { type: "csv", id: legacyId },
      },
    };
  },
};
