/**
 * The tasks template (P6-T01a).
 *
 * **`position` is not a column.** §7.2 says it for the FlowyTeam importer and
 * it is true here: a source system's ordering is its own, and this product's
 * sparse spacing is what makes two people dragging a card at once safe. The
 * position is renumbered on load.
 *
 * **Assignees are one column and one member.** A file with three names in a
 * cell is a mapping question rather than a parsing one, and splitting on commas
 * would quietly assign "Smith" and "John" as two people. A second assignee is
 * something the board does in a second.
 */
import { richTextFromPlainText } from "@openokr/core";
import { TASK_STATUSES } from "@openokr/db";
import { asDay, asEnum, asText } from "./coerce.ts";
import type { EntityTemplate, PlanContext, RowPlan } from "./types.ts";

export const tasksTemplate: EntityTemplate = {
  entity: "tasks",
  describe: "Tasks, one per row, each in a space and on a board column.",
  legacyField: "externalId",
  legacyTable: "tasks",
  columns: [
    {
      field: "externalId",
      describe: "The identifier the source system uses for this task.",
      aliases: ["externalId", "id", "sourceId", "legacyId", "taskId"],
      required: true,
    },
    {
      field: "title",
      describe: "What has to happen.",
      aliases: ["title", "task", "name", "summary"],
      required: true,
    },
    {
      field: "description",
      describe: "Detail, as plain text.",
      aliases: ["description", "notes", "detail"],
      required: false,
    },
    {
      field: "space",
      describe: "The space the task sits in, by name.",
      aliases: ["space", "team", "department", "board"],
      required: true,
    },
    {
      field: "status",
      describe: `The board column. One of: ${TASK_STATUSES.join(", ")}. Backlog by default.`,
      aliases: ["status", "column", "state", "stage"],
      required: false,
    },
    {
      field: "dueOn",
      describe: "The day it is due.",
      aliases: ["dueOn", "dueDate", "due", "deadline"],
      required: false,
    },
    {
      field: "initiative",
      describe:
        "The initiative it belongs to, by the identifier the initiatives file used.",
      aliases: ["initiative", "project", "initiativeId", "projectId"],
      required: false,
    },
    {
      field: "keyResult",
      describe:
        "The key result it moves, by the identifier the key results file used.",
      aliases: ["keyResult", "keyResultId", "measure", "kr"],
      required: false,
    },
    {
      field: "assignee",
      describe: "The member doing it, by email address.",
      aliases: ["assignee", "owner", "responsible", "assignedTo"],
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

    const shared = {
      title,
      ...(description ? { description } : {}),
      ...(values.status
        ? { status: asEnum("status", values.status, TASK_STATUSES) }
        : {}),
      ...(values.dueOn ? { dueOn: asDay("dueOn", values.dueOn) } : {}),
      ...(values.initiative
        ? { initiativeId: await references.initiative(values.initiative) }
        : {}),
      ...(values.keyResult
        ? { keyResultId: await references.keyResult(values.keyResult) }
        : {}),
    };

    if (existingId) {
      // The assignee is not updated. Taking somebody off a task is a decision
      // made on the board, and a re-run of an old file should not undo it.
      return {
        kind: "update",
        action: "tasks.update",
        input: { id: existingId, ...shared },
      };
    }

    return {
      kind: "create",
      action: "tasks.create",
      input: {
        spaceId: await references.space(values.space ?? ""),
        ...shared,
        ...(values.assignee
          ? { assigneeIds: [await references.member(values.assignee)] }
          : {}),
        legacy: { type: "csv", id: legacyId },
      },
    };
  },
};
