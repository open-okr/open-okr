/**
 * The goals template (P6-T01a).
 *
 * **A goal sits in a cycle or carries its own timeframe, and the file has to
 * say which.** OBJ-3 refuses both and refuses neither, so a row with a cycle
 * and a start date is a row error here rather than a refusal from the action
 * three steps later.
 *
 * **The champion and the reviewer are required, because the product requires
 * them.** A source system that records neither has no answer to "whose is
 * this", and inventing one would put a person's name against work they never
 * agreed to. The file has to name them, which is a mapping question a person
 * can answer once for the whole file.
 */

import { GOAL_LEVELS } from "@openokr/db";
import { richTextFromPlainText } from "../../rich-text/from-text.ts";
import { asDay, asEnum, asNumber, asText } from "./coerce.ts";
import type { EntityTemplate, PlanContext, RowPlan } from "./types.ts";

export const goalsTemplate: EntityTemplate = {
  entity: "goals",
  describe: "Objectives, one per row, with their champion and their reviewer.",
  legacyField: "externalId",
  legacyTable: "goals",
  columns: [
    {
      field: "externalId",
      describe:
        "The identifier the source system uses for this objective. Re-running the file finds this row by it rather than creating a second one.",
      aliases: ["externalId", "id", "sourceId", "legacyId", "objectiveId"],
      required: true,
    },
    {
      field: "title",
      describe: "The objective itself.",
      aliases: ["title", "objective", "name", "goal"],
      required: true,
    },
    {
      field: "description",
      describe: "Context, as plain text. Blank lines separate paragraphs.",
      aliases: ["description", "context", "notes", "detail"],
      required: false,
    },
    {
      field: "level",
      describe: `One of: ${GOAL_LEVELS.join(", ")}.`,
      aliases: ["level", "tier", "scope"],
      required: true,
    },
    {
      field: "cycle",
      describe:
        "The cycle this objective belongs to, by name or label. Leave it empty and give a start and an end instead.",
      aliases: ["cycle", "quarter", "period"],
      required: false,
    },
    {
      field: "startsOn",
      describe: "The first day, when the objective carries its own timeframe.",
      aliases: ["startsOn", "startDate", "start", "from"],
      required: false,
    },
    {
      field: "endsOn",
      describe: "The last day, when the objective carries its own timeframe.",
      aliases: ["endsOn", "endDate", "end", "due", "to"],
      required: false,
    },
    {
      field: "space",
      describe:
        "The space that owns it, by name. Leave it empty for a workspace-level objective.",
      aliases: ["space", "team", "department", "unit"],
      required: false,
    },
    {
      field: "champion",
      describe: "The member who runs it, by email address.",
      aliases: ["champion", "owner", "accountable", "responsible"],
      required: true,
    },
    {
      field: "reviewer",
      describe: "The member who reviews it, by email address.",
      aliases: ["reviewer", "manager", "approver"],
      required: true,
    },
    {
      field: "parent",
      describe:
        "The objective this one aligns to, by its identifier in this same file or by its id here.",
      aliases: ["parent", "parentId", "alignsTo", "parentObjective"],
      required: false,
    },
    {
      field: "weight",
      describe:
        "How much of the parent this objective carries. One by default.",
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
    const level = asEnum("level", values.level ?? "", GOAL_LEVELS);
    const description = values.description
      ? richTextFromPlainText(values.description)
      : undefined;
    const weight =
      values.weight === undefined || values.weight === ""
        ? undefined
        : asNumber("weight", values.weight);

    if (existingId) {
      // The cycle, the timeframe and the owner are not updated. An objective
      // that has moved cycle is a decision somebody made in the product, and a
      // re-run of an old file should not move it back.
      return {
        kind: "update",
        action: "goals.update",
        input: {
          id: existingId,
          title,
          level,
          ...(description ? { description } : {}),
          ...(weight === undefined ? {} : { weight }),
          ...(values.parent
            ? { parentGoalId: await references.goal(values.parent) }
            : {}),
        },
      };
    }

    const hasCycle = Boolean(values.cycle);
    const hasTimeframe = Boolean(values.startsOn || values.endsOn);
    if (hasCycle === hasTimeframe) {
      throw new Error(
        hasCycle
          ? "A goal sits in a cycle or carries its own start and end, not both. This row has a cycle and a date."
          : "A goal sits in a cycle or carries its own start and end. This row has neither.",
      );
    }
    if (hasTimeframe && !(values.startsOn && values.endsOn)) {
      throw new Error(
        "An objective with its own timeframe needs both a start and an end.",
      );
    }

    return {
      kind: "create",
      action: "goals.create",
      input: {
        title,
        level,
        ...(description ? { description } : {}),
        ...(hasCycle
          ? { cycleId: await references.cycle(values.cycle as string) }
          : {
              timeframe: {
                startsOn: asDay("startsOn", values.startsOn as string),
                endsOn: asDay("endsOn", values.endsOn as string),
              },
            }),
        ...(values.space
          ? {
              ownerKind: "space",
              spaceId: await references.space(values.space),
            }
          : { ownerKind: "workspace" }),
        championId: await references.member(values.champion ?? ""),
        reviewerId: await references.member(values.reviewer ?? ""),
        ...(values.parent
          ? { parentGoalId: await references.goal(values.parent) }
          : {}),
        ...(weight === undefined ? {} : { weight }),
        legacy: { type: "csv", id: legacyId },
      },
    };
  },
};
