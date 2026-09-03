/**
 * The initiatives template (P6-T01a).
 *
 * **`capacity` is not a column, and that is deliberate.** METHOD.md §5.5's
 * verdict on whether a team can actually carry the work is a judgement a room
 * makes, and no source system holds one. §7.2 says the same about the FlowyTeam
 * importer: capacity arrives null and a room fills it in.
 *
 * **Progress is not a column either.** It is recomputed from the imported
 * tasks, which is §7.1 step 6: derived values are recomputed after load and
 * never carried from the source.
 */

import { INITIATIVE_STATUSES } from "@openokr/db";
import { richTextFromPlainText } from "../../rich-text/from-text.ts";
import { asDay, asEnum, asNumber, asText } from "./coerce.ts";
import type { EntityTemplate, PlanContext, RowPlan } from "./types.ts";

export const initiativesTemplate: EntityTemplate = {
  entity: "initiatives",
  describe: "Initiatives, one per row, each in a space and owned by a member.",
  legacyField: "externalId",
  legacyTable: "initiatives",
  columns: [
    {
      field: "externalId",
      describe: "The identifier the source system uses for this initiative.",
      aliases: ["externalId", "id", "sourceId", "legacyId", "projectId"],
      required: true,
    },
    {
      field: "title",
      describe: "What the work is.",
      aliases: ["title", "initiative", "project", "name"],
      required: true,
    },
    {
      field: "description",
      describe: "Context, as plain text.",
      aliases: ["description", "notes", "detail", "summary"],
      required: false,
    },
    {
      field: "space",
      describe: "The space the work sits in, by name.",
      aliases: ["space", "team", "department", "unit"],
      required: true,
    },
    {
      field: "owner",
      describe: "The member who owns it, by email address.",
      aliases: ["owner", "lead", "responsible", "champion"],
      required: true,
    },
    {
      field: "status",
      describe: `One of: ${INITIATIVE_STATUSES.join(", ")}. Planned by default.`,
      aliases: ["status", "state", "stage"],
      required: false,
    },
    {
      field: "startsOn",
      describe: "The first day.",
      aliases: ["startsOn", "startDate", "start", "from"],
      required: false,
    },
    {
      field: "endsOn",
      describe: "The last day.",
      aliases: ["endsOn", "endDate", "end", "due", "to"],
      required: false,
    },
    {
      field: "confidence",
      describe: "Confidence from 0 to 1, when the source records one.",
      aliases: ["confidence", "certainty"],
      required: false,
    },
    {
      field: "keyResult",
      describe:
        "The key result this initiative moves, by the identifier the key results file used.",
      aliases: ["keyResult", "keyResultId", "measure", "kr"],
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
    const description = values.description
      ? richTextFromPlainText(values.description)
      : undefined;
    const confidence =
      values.confidence === undefined || values.confidence === ""
        ? undefined
        : asNumber("confidence", values.confidence);
    if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
      throw new Error(
        `confidence is a number between 0 and 1, and it says "${values.confidence}".`,
      );
    }

    const shared = {
      title,
      ...(description ? { description } : {}),
      ...(values.status
        ? { status: asEnum("status", values.status, INITIATIVE_STATUSES) }
        : {}),
      ...(values.startsOn
        ? { startsOn: asDay("startsOn", values.startsOn) }
        : {}),
      ...(values.endsOn ? { endsOn: asDay("endsOn", values.endsOn) } : {}),
      ...(confidence === undefined ? {} : { confidence }),
    };

    if (existingId) {
      // The space is not updated: moving an initiative between spaces changes
      // who may see it, which is an access decision rather than a field.
      return {
        kind: "update",
        action: "initiatives.update",
        input: {
          id: existingId,
          ...shared,
          ownerId: await references.member(values.owner ?? ""),
        },
      };
    }

    return {
      kind: "create",
      action: "initiatives.create",
      input: {
        spaceId: await references.space(values.space ?? ""),
        ownerId: await references.member(values.owner ?? ""),
        ...shared,
        ...(values.keyResult
          ? { keyResultIds: [await references.keyResult(values.keyResult)] }
          : {}),
        legacy: { type: "csv", id: legacyId },
      },
    };
  },
};
