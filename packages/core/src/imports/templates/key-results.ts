/**
 * The key results template (P6-T01a).
 *
 * **A metric or a maintain key result needs its direction, baseline and
 * target; a milestone or a baseline needs none** (METHOD.md §2.10, P9-T12c-b).
 * They are asked of each row by its kind rather than of the file, so a file
 * of milestones needs no number columns at all. A file with no kind column
 * writes metrics, or maintains where the direction says so, and the report
 * says that is what happened. A measure with no baseline has no progress to
 * compute, and a measure with no target is not a measure. The current value defaults to the baseline, which is
 * what a key result created in the product does, and the create records it as
 * the first point of history.
 *
 * **A row names its goal by the identifier the goals file used.** That is what
 * makes the two files a pair: import the objectives, then the measures, and the
 * second finds the first by the source system's own identifiers rather than by
 * matching titles.
 */
import {
  INDICATOR_TYPES,
  KEY_RESULT_DIRECTIONS,
  KEY_RESULT_KINDS,
} from "@openokr/db";
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
      example: "KR-1",
    },
    {
      field: "goal",
      describe:
        "The objective it measures, by the identifier the goals file used or by its id here.",
      aliases: ["goal", "objective", "goalId", "objectiveId", "parent"],
      required: true,
      example: "OBJ-1",
    },
    {
      field: "title",
      describe: "The measure itself.",
      aliases: ["title", "keyResult", "measure", "name"],
      required: true,
      example: "Teams that finish their first check-in in week one",
    },
    {
      field: "kind",
      describe: `One of: ${KEY_RESULT_KINDS.join(", ")} (METHOD.md §2.10). A metric if the file does not say, or a maintain where the direction says maintain.`,
      aliases: ["kind", "keyResultKind", "measureKind"],
      required: false,
      example: "metric",
      whenAbsent:
        "This file has no kind column, so every key result arrives as a metric, or as a maintain where its direction says maintain.",
    },
    {
      field: "direction",
      describe: `One of: ${KEY_RESULT_DIRECTIONS.join(", ")}. Needed for a metric or a maintain.`,
      aliases: ["direction", "movement"],
      required: false,
      example: "increase",
    },
    {
      field: "indicatorType",
      describe: `One of: ${INDICATOR_TYPES.join(", ")}. Lagging by default.`,
      aliases: ["indicatorType", "indicator", "type"],
      required: false,
      example: "lagging",
    },
    {
      field: "unit",
      describe: "What the numbers are in, such as % or customers.",
      aliases: ["unit", "measureUnit", "uom"],
      required: false,
      example: "%",
    },
    {
      field: "baselineValue",
      describe: "Where it started. Needed for a metric or a maintain.",
      aliases: ["baselineValue", "baseline", "startValue", "from"],
      required: false,
      example: "20",
    },
    {
      field: "targetValue",
      describe: "Where it has to reach. Needed for a metric or a maintain.",
      aliases: ["targetValue", "target", "goalValue", "to"],
      required: false,
      example: "60",
    },
    {
      field: "currentValue",
      describe: "Where it is now. The baseline, if the file does not say.",
      aliases: ["currentValue", "current", "actual", "latest"],
      required: false,
      example: "20",
    },
    {
      field: "dueOn",
      describe: "The day it is measured to.",
      aliases: ["dueOn", "dueDate", "due", "deadline"],
      required: false,
      example: "2027-03-31",
    },
    {
      field: "owner",
      describe: "The member who owns the measure, by email address.",
      aliases: ["owner", "champion", "responsible"],
      required: false,
      example: "alex@example.com",
    },
    {
      field: "weight",
      describe: "How much of the objective it carries. One by default.",
      aliases: ["weight", "contribution"],
      required: false,
      example: "1",
    },
  ],

  async plan({
    values,
    legacyId,
    existingId,
    references,
  }: PlanContext): Promise<RowPlan> {
    const title = asText("title", values.title ?? "");
    const kind = values.kind
      ? asEnum("kind", values.kind, KEY_RESULT_KINDS)
      : undefined;
    // §2.10: only a metric and a maintain move a number, so only they must
    // say which way, from where and to where. A milestone or a baseline may
    // still carry them; they are then kept and not read.
    const measured = kind !== "milestone" && kind !== "baseline";
    const direction =
      measured || values.direction
        ? asEnum("direction", values.direction ?? "", KEY_RESULT_DIRECTIONS)
        : undefined;
    const indicatorType = values.indicatorType
      ? asEnum("indicatorType", values.indicatorType, INDICATOR_TYPES)
      : "lagging";
    const baselineValue =
      measured || values.baselineValue
        ? asNumber("baselineValue", values.baselineValue ?? "")
        : undefined;
    const targetValue =
      measured || values.targetValue
        ? asNumber("targetValue", values.targetValue ?? "")
        : undefined;
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
      ...(kind ? { kind } : {}),
      ...(direction ? { direction } : {}),
      indicatorType,
      ...(baselineValue === undefined ? {} : { baselineValue }),
      ...(targetValue === undefined ? {} : { targetValue }),
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
