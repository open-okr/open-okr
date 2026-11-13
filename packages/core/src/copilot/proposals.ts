/**
 * What the copilot may propose, and how (AI-NATIVE-PLAN.md §2.4, P4-T14b-a).
 *
 * **A model never names an entity and never writes a payload.** It picks an
 * action from a curated list and authors only the fields a person would type:
 * a title, a sentence, a level. Every identifier in the resulting payload is the
 * product's, resolved from the asking member's own readable data. Anything the
 * model has to point at is given to it as a numbered list and referred to by
 * index, exactly as citations are, so an index out of range resolves to nothing
 * rather than to somebody else's space.
 *
 * **The list is short on purpose.** Least privilege is the rule for agents
 * (CLAUDE.md), and it is the rule here for the same reason: a copilot that may
 * propose any registered write is a copilot that may propose `people.erase`,
 * and a model handed three hundred tools picks worse than one handed four.
 * The four are the planning writes a person asks for in a sentence: an
 * objective, a key result under one, and the initiative or task that moves a
 * key result (completeness review M-09, which found `goals.create` alone).
 *
 * **Only what the member may change is offered.** Every numbered list is
 * filtered through the access model before the model sees it, at the level the
 * action itself asks for: `edit` on a space to create in it, `edit` on an
 * objective to add a key result to it, and for work behind a key result, `edit`
 * on the space the work lands in and `view` on the objective (plan 0.8.1 A1).
 * Applying still runs the action as the member, whose own authorisation
 * decides again: the offer narrows what can be proposed, the action decides
 * what can be done.
 *
 * **Every entry declares its own reverse, or admits it has none.** A proposal
 * that cannot be undone is still applicable; the interface says so instead of
 * offering a button that does nothing.
 *
 * **Three edits join the creates (plan 0.9.0 L4a):** an objective's title and
 * description, a task's status and an initiative's status. An edit returns
 * only an id, so there is nothing to reverse from afterwards. Applying one
 * therefore reads the values from before through the product's own read
 * actions, as the member, just before the action runs (`capture`), and undo
 * checks the record still holds what the edit left (`current`) before it puts
 * the old values back. Deletes are not on this list and never will be.
 *
 * **Two more join them (plan 0.9.0 L4c):** a check-in and a KPI value. Their
 * undo needs what applying returned, the new check-in's id or the new KPI
 * value's id, which does not exist until the action has run. `capture` reads
 * the values from before, and `settle` fills in the id from the result. A
 * check-in's undo is refused unless it is still the goal's latest, and a KPI
 * value's undo is refused unless the period still holds what the copilot
 * recorded, so an undo never removes or overwrites what a person did after.
 */

import {
  CHECK_IN_STATUSES,
  INDICATOR_TYPES,
  INITIATIVE_STATUSES,
  KEY_RESULT_DIRECTIONS,
  TASK_STATUSES,
  withContext,
} from "@openokr/db";
import { LOCAL_DATE_PATTERN } from "@openokr/formats";
import { type KpiFrequency, normalisePeriod } from "@openokr/method";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { visibleResourceIds } from "../access/reads.ts";
import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";
import type { ProposalDrop, ProposalNote } from "../agents/drafter.ts";
import { formatLocalDate, localDateIn } from "../cycles/generation.ts";
import { cyclesOpenForWork } from "../cycles/open-for-work.ts";
import { workspaceTimeZone } from "../cycles/service.ts";
import {
  OperationError,
  type OperationTx,
  writeFloorFor,
} from "../operations/operation.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";
import { richTextFromPlainText } from "../rich-text/from-text.ts";
import type { RichTextDocument } from "../rich-text/schema.ts";
import { errorNameOf, logProposalDrop } from "./proposal-drops.ts";

/** One thing the model may be shown and point at by number. */
export interface NumberedChoice {
  readonly id: string;
  readonly label: string;
  /**
   * What the product needs to build a payload from this choice, kept beside it
   * and never shown to the model: the space a key result's objective belongs
   * to, say. Only `label` crosses to the provider.
   */
  readonly with?: Readonly<Record<string, string>>;
}

/** What the model is told it may propose, and what it may choose from. */
export interface ProposalOffer {
  readonly action: string;
  readonly label: string;
  /** In plain words, for the prompt. */
  readonly whatItDoes: string;
  /** The fields the model may author, as a JSON Schema for the provider. */
  readonly fields: Record<string, unknown>;
  /** Lists the model may index into. Empty when the action needs none. */
  readonly choices: Readonly<Record<string, readonly NumberedChoice[]>>;
}

/** What the model came back with. Field values only, never an identifier. */
export interface AuthoredProposal {
  readonly action: string;
  readonly fields: Record<string, unknown>;
  /** One sentence for the reviewer, in the model's own words. */
  readonly why: string;
}

/** A proposal ready to store: a real registry payload and a preview. */
export interface BuiltProposal {
  readonly action: string;
  readonly payload: Record<string, unknown>;
  /** Label and value pairs the panel shows before anything is applied. */
  readonly preview: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly subjectType: string | null;
  readonly subjectId: string | null;
}

/** How to reverse an applied proposal, or null when nothing reverses it. */
export interface Reversal {
  readonly action: string;
  readonly payload: Record<string, unknown>;
}

/** The values an edit changes, read as the product reads them. */
type Fields = Record<string, unknown>;

/** What reading before an edit yields: how to put it back, and what it leaves. */
interface Captured {
  readonly reverse: Reversal;
  /** The values the edit leaves, which undo expects to still find. */
  readonly expect: Fields;
}

/** What `proposed_changes.reverse_payload` holds. */
export interface StoredReverse extends Reversal {
  readonly expect: Fields;
}

interface ProposableAction {
  readonly action: string;
  readonly label: string;
  readonly whatItDoes: string;
  /** What the model may author. Validated before anything is stored. */
  readonly authored: z.ZodType<Record<string, unknown>>;
  readonly fields: Record<string, unknown>;
  /** The numbered lists this action needs, resolved for the asking member. */
  offer(scope: OfferScope): Promise<ProposalOffer["choices"]>;
  /** Turns authored fields plus product-owned ids into a registry payload. */
  build(
    context: ActionCallContext,
    fields: Record<string, unknown>,
    choices: ProposalOffer["choices"],
  ): Promise<BuiltProposal>;
  /**
   * One more sentence for the model about this offer, read as the member:
   * today's date, for an action that takes a period.
   */
  note?(scope: OfferScope): Promise<string>;
  /** The reverse, given what applying it returned. */
  reverse(result: Record<string, unknown>): Reversal | null;
  /**
   * An edit only: completes what `capture` read once the action has run, for
   * a reverse that needs what the action created. Null means it cannot be put
   * back after all.
   */
  settle?(captured: Captured, result: Record<string, unknown>): Captured | null;
  /**
   * An edit only: reads the values from before, as the member, to build the
   * reverse. Called just before the action runs, with the payload it will run.
   * Null means this edit cannot be put back, and the card says so.
   */
  capture?(
    context: ActionCallContext,
    payload: Record<string, unknown>,
  ): Promise<Captured | null>;
  /**
   * An edit only: the fields `capture` expects, as they are now, for undo's
   * staleness check.
   */
  current?(
    context: ActionCallContext,
    payload: Record<string, unknown>,
  ): Promise<Fields>;
}

/** How a status reads in a preview and in the labels the model is shown. */
const TASK_STATUS_WORD: Readonly<Record<string, string>> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};
const INITIATIVE_STATUS_WORD: Readonly<Record<string, string>> = {
  planned: "Planned",
  active: "Active",
  done: "Done",
  dropped: "Dropped",
};

/** A rich text value as one short line, for a before and after row. */
function lineOf(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    try {
      const line = excerptRichText(value as RichTextDocument, 160);
      return line === "" ? "(empty)" : line;
    } catch {
      return "(empty)";
    }
  }
  return "(empty)";
}

const GOAL_LEVELS = ["company", "department", "team", "individual"] as const;

/**
 * Creating an objective.
 *
 * The model writes a title, a sentence of description and a level, and picks a
 * space by number. Everything else comes from the product: the current cycle,
 * the space's real identifier, and the asking member as both champion and
 * reviewer, because a copilot proposal is that member's own suggestion and
 * naming somebody else as accountable is not a model's call.
 */
const createObjective: ProposableAction = {
  action: "goals.create",
  label: "Create an objective",
  whatItDoes:
    "Adds a new objective to the current quarterly cycle, owned by a space.",
  authored: z.object({
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(2000).optional(),
    level: z.enum(GOAL_LEVELS),
    /** One-based, into the `spaces` list the model was shown. */
    spaceNumber: z.number().int().min(1),
    /** The person's own words for why it starts now (design §4.3). */
    reason: z.string().trim().max(500).optional(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  fields: {
    type: "object",
    additionalProperties: false,
    required: ["title", "level", "spaceNumber"],
    properties: {
      title: { type: "string", maxLength: 500 },
      description: { type: "string", maxLength: 2000 },
      level: { type: "string", enum: [...GOAL_LEVELS] },
      spaceNumber: { type: "integer", minimum: 1 },
      reason: { type: "string", maxLength: 500 },
    },
  },
  async offer(scope) {
    return { spaces: await scope.editableSpaces() };
  },
  async build(context, fields, choices) {
    const authored = fields as {
      title: string;
      description?: string;
      level: (typeof GOAL_LEVELS)[number];
      spaceNumber: number;
      reason?: string;
    };
    const spaces = choices.spaces ?? [];
    const space = spaces[authored.spaceNumber - 1];
    if (!space) {
      // Out of range is a model miscounting. Refused rather than resolved to
      // the first space, which would put an objective somewhere nobody chose.
      throw new Error("That is not one of the spaces you were shown.");
    }
    const cycle = await callAction(context, "cycles.current", {
      mode: "quarterly",
    });
    if (!cycle) {
      // A workspace with no quarterly cycle has nowhere to put an objective.
      // Refused with a sentence, rather than proposing one into nothing.
      throw new Error("This workspace has no quarterly cycle to put it in.");
    }
    const memberId = await askingMember(context);

    return {
      action: "goals.create",
      payload: {
        title: authored.title,
        ...(authored.description
          ? { description: richTextFromPlainText(authored.description) }
          : {}),
        cycleId: cycle.id,
        level: authored.level,
        ownerKind: "space",
        spaceId: space.id,
        championId: memberId,
        reviewerId: memberId,
        weight: 1,
        ...(authored.reason ? { reason: authored.reason } : {}),
      },
      preview: [
        { label: "Objective", value: authored.title },
        ...(authored.description
          ? [{ label: "Description", value: authored.description }]
          : []),
        { label: "Level", value: authored.level },
        { label: "Space", value: space.label },
        { label: "Cycle", value: cycle.name },
        ...(authored.reason
          ? [{ label: "Reason", value: authored.reason }]
          : []),
      ],
      subjectType: "space",
      subjectId: space.id,
    };
  },
  reverse(result) {
    const id = result.id;
    return typeof id === "string"
      ? { action: "goals.delete", payload: { id } }
      : null;
  },
};

/** The one-based pick into a list, or a refusal naming the list. */
function picked(
  choices: ProposalOffer["choices"],
  list: string,
  number: number,
): NumberedChoice {
  const choice = (choices[list] ?? [])[number - 1];
  if (!choice) {
    // A model miscounting. Refused rather than resolved to the first entry,
    // which would change something nobody chose.
    throw new Error(`That is not one of the ${list} you were shown.`);
  }
  return choice;
}

/** A value from a choice's hidden half, or a refusal when it is missing. */
function carried(choice: NumberedChoice, key: string): string {
  const value = choice.with?.[key];
  if (value === undefined) {
    throw new Error("That choice cannot be proposed on.");
  }
  return value;
}

/**
 * Adding a key result to an objective (M-09).
 *
 * The model writes the sentence and the numbers a person would type, and picks
 * the objective by number from the ones this member may edit. The owner is the
 * asking member and the date is the cycle's last day, which is what KR-3 asks a
 * key result to carry and what the drafting assist on phase 4 already does, so
 * a proposed key result is no weaker than a drafted one.
 *
 * **No reverse.** The registry has no action that removes a key result, and
 * inventing one to serve an undo would be a delete path nobody designed. The
 * panel says the proposal cannot be undone once it is applied.
 */
const addKeyResult: ProposableAction = {
  action: "goals.addKeyResult",
  label: "Add a key result",
  whatItDoes:
    "Adds a measurable key result, with a baseline and a target, to an objective in the current quarterly cycle.",
  authored: z.object({
    title: z.string().trim().min(1).max(500),
    unit: z.string().trim().max(60).optional(),
    direction: z.enum(KEY_RESULT_DIRECTIONS),
    indicatorType: z.enum(INDICATOR_TYPES),
    baseline: z.number().finite(),
    target: z.number().finite(),
    /** One-based, into the `objectives` list the model was shown. */
    objectiveNumber: z.number().int().min(1),
    /** The person's own words for why it starts now (design §4.3). */
    reason: z.string().trim().max(500).optional(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  fields: {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "direction",
      "indicatorType",
      "baseline",
      "target",
      "objectiveNumber",
    ],
    properties: {
      title: { type: "string", maxLength: 500 },
      unit: { type: "string", maxLength: 60 },
      direction: { type: "string", enum: [...KEY_RESULT_DIRECTIONS] },
      indicatorType: { type: "string", enum: [...INDICATOR_TYPES] },
      baseline: { type: "number" },
      target: { type: "number" },
      objectiveNumber: { type: "integer", minimum: 1 },
      reason: { type: "string", maxLength: 500 },
    },
  },
  async offer(scope) {
    return { objectives: await scope.editableObjectives() };
  },
  async build(context, fields, choices) {
    const authored = fields as {
      title: string;
      unit?: string;
      direction: (typeof KEY_RESULT_DIRECTIONS)[number];
      indicatorType: (typeof INDICATOR_TYPES)[number];
      baseline: number;
      target: number;
      objectiveNumber: number;
      reason?: string;
    };
    const objective = picked(choices, "objectives", authored.objectiveNumber);
    const memberId = await askingMember(context);
    const dueOn = objective.with?.cycleEndsOn;
    const unit = authored.unit ? authored.unit : null;
    const measure = (value: number) =>
      unit === null ? String(value) : `${value} ${unit}`;

    return {
      action: "goals.addKeyResult",
      payload: {
        goalId: objective.id,
        title: authored.title,
        ...(unit === null ? {} : { unit }),
        direction: authored.direction,
        indicatorType: authored.indicatorType,
        baselineValue: authored.baseline,
        targetValue: authored.target,
        ownerId: memberId,
        weight: 1,
        ...(dueOn ? { dueOn } : {}),
        ...(authored.reason ? { reason: authored.reason } : {}),
      },
      preview: [
        { label: "Key result", value: authored.title },
        { label: "Objective", value: objective.label },
        { label: "Baseline", value: measure(authored.baseline) },
        { label: "Target", value: measure(authored.target) },
        { label: "Direction", value: authored.direction },
        { label: "Indicator", value: authored.indicatorType },
        ...(authored.reason
          ? [{ label: "Reason", value: authored.reason }]
          : []),
      ],
      subjectType: "goal",
      subjectId: objective.id,
    };
  },
  reverse() {
    return null;
  },
};

/**
 * Starting an initiative behind a key result (M-09).
 *
 * The model writes a title and a sentence and picks the key result by number.
 * The space is the one the key result's objective belongs to, and only key
 * results in a space this member may create work in are offered, because an
 * initiative lives in a space and `initiatives.create` asks for `edit` there.
 * The objective itself needs only `view` (plan 0.8.1 A1): a member who works
 * in the Product space can start work behind its objective without owning it.
 */
const startInitiative: ProposableAction = {
  action: "initiatives.create",
  label: "Start an initiative",
  whatItDoes:
    "Starts an initiative, owned by the person asking, behind one key result, in the space its objective belongs to.",
  authored: z.object({
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(2000).optional(),
    /** One-based, into the `keyResults` list the model was shown. */
    keyResultNumber: z.number().int().min(1),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  fields: {
    type: "object",
    additionalProperties: false,
    required: ["title", "keyResultNumber"],
    properties: {
      title: { type: "string", maxLength: 500 },
      description: { type: "string", maxLength: 2000 },
      keyResultNumber: { type: "integer", minimum: 1 },
    },
  },
  async offer(scope) {
    return { keyResults: await scope.workKeyResults() };
  },
  async build(context, fields, choices) {
    const authored = fields as {
      title: string;
      description?: string;
      keyResultNumber: number;
    };
    const keyResult = picked(choices, "keyResults", authored.keyResultNumber);
    const memberId = await askingMember(context);
    return {
      action: "initiatives.create",
      payload: {
        spaceId: carried(keyResult, "spaceId"),
        title: authored.title,
        ...(authored.description
          ? { description: richTextFromPlainText(authored.description) }
          : {}),
        ownerId: memberId,
        keyResultIds: [keyResult.id],
      },
      preview: [
        { label: "Initiative", value: authored.title },
        ...(authored.description
          ? [{ label: "Description", value: authored.description }]
          : []),
        { label: "Key result", value: keyResult.label },
      ],
      subjectType: "goal",
      subjectId: carried(keyResult, "goalId"),
    };
  },
  reverse(result) {
    const id = result.id;
    return typeof id === "string"
      ? { action: "initiatives.delete", payload: { id } }
      : null;
  },
};

/**
 * Adding a task behind a key result (M-09).
 *
 * The smallest write on the list, and the one a sentence asks for most often.
 * Assigned to the asking member, for the reason an objective is championed by
 * them: the proposal is their own, and giving somebody else work is not a
 * model's call.
 */
const addTask: ProposableAction = {
  action: "tasks.create",
  label: "Add a task",
  whatItDoes:
    "Adds a task for the person asking, behind one key result, in the space its objective belongs to.",
  authored: z.object({
    title: z.string().trim().min(1).max(500),
    /** One-based, into the `keyResults` list the model was shown. */
    keyResultNumber: z.number().int().min(1),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  fields: {
    type: "object",
    additionalProperties: false,
    required: ["title", "keyResultNumber"],
    properties: {
      title: { type: "string", maxLength: 500 },
      keyResultNumber: { type: "integer", minimum: 1 },
    },
  },
  async offer(scope) {
    return { keyResults: await scope.workKeyResults() };
  },
  async build(context, fields, choices) {
    const authored = fields as { title: string; keyResultNumber: number };
    const keyResult = picked(choices, "keyResults", authored.keyResultNumber);
    const memberId = await askingMember(context);
    return {
      action: "tasks.create",
      payload: {
        spaceId: carried(keyResult, "spaceId"),
        title: authored.title,
        keyResultId: keyResult.id,
        assigneeIds: [memberId],
      },
      preview: [
        { label: "Task", value: authored.title },
        { label: "Key result", value: keyResult.label },
      ],
      subjectType: "goal",
      subjectId: carried(keyResult, "goalId"),
    };
  },
  reverse(result) {
    const id = result.id;
    return typeof id === "string"
      ? { action: "tasks.delete", payload: { id } }
      : null;
  },
};

/**
 * Renaming or redescribing an objective (plan 0.9.0 L4a).
 *
 * The model writes the new title and a sentence of description and picks the
 * objective by number from the ones this member may edit. The preview reads
 * `Title: old -> new`, with the old values read now as the member.
 *
 * **Undo needs an expectation.** `goals.update` has no read guard, so a later
 * edit by somebody else would be overwritten by an undo that wrote the old
 * title back. `expect` holds what this edit left and undo refuses when the
 * objective no longer holds it.
 */
const editObjective: ProposableAction = {
  action: "goals.update",
  label: "Rename or redescribe an objective",
  whatItDoes:
    "Changes the title or the description of one objective the person may edit. Writes only the fields the person asked to change.",
  authored: z
    .object({
      /** One-based, into the `objectives` list the model was shown. */
      objectiveNumber: z.number().int().min(1),
      title: z.string().trim().min(1).max(500).optional(),
      description: z.string().trim().max(2000).optional(),
    })
    .refine(
      (value) => value.title !== undefined || value.description !== undefined,
      { message: "an edit has to change something" },
    ) as unknown as z.ZodType<Record<string, unknown>>,
  fields: {
    type: "object",
    additionalProperties: false,
    required: ["objectiveNumber"],
    properties: {
      objectiveNumber: { type: "integer", minimum: 1 },
      title: { type: "string", maxLength: 500 },
      description: { type: "string", maxLength: 2000 },
    },
  },
  async offer(scope) {
    return { objectives: await scope.editableObjectives() };
  },
  async build(context, fields, choices) {
    const authored = fields as {
      objectiveNumber: number;
      title?: string;
      description?: string;
    };
    const objective = picked(choices, "objectives", authored.objectiveNumber);
    const now = await callAction(context, "goals.read", { id: objective.id });
    const newTitle = authored.title ? authored.title : undefined;
    const newDescription = authored.description
      ? authored.description
      : undefined;
    if (
      (newTitle === undefined || newTitle === now.title) &&
      newDescription === undefined
    ) {
      // Nothing to put in place of what is there. No card rather than a
      // proposal that changes nothing.
      throw new Error("That would not change the objective.");
    }
    // A title the model repeats unchanged is not a change, so it stays out of
    // the payload and the preview rather than reading "X -> X".
    const titleChanged = newTitle !== undefined && newTitle !== now.title;
    return {
      action: "goals.update",
      payload: {
        id: objective.id,
        ...(titleChanged ? { title: newTitle } : {}),
        ...(newDescription === undefined
          ? {}
          : { description: richTextFromPlainText(newDescription) }),
      },
      preview: [
        { label: "Objective", value: now.title },
        ...(titleChanged
          ? [{ label: "Title", value: `${now.title} -> ${newTitle}` }]
          : []),
        ...(newDescription === undefined
          ? []
          : [
              {
                label: "Description",
                value: `${lineOf(now.description)} -> ${newDescription}`,
              },
            ]),
      ],
      subjectType: "goal",
      subjectId: objective.id,
    };
  },
  reverse() {
    return null;
  },
  async capture(context, payload) {
    const id = String(payload.id);
    const now = await callAction(context, "goals.read", { id });
    return {
      reverse: {
        action: "goals.update",
        payload: {
          id,
          ...(payload.title === undefined ? {} : { title: now.title }),
          ...(payload.description === undefined
            ? {}
            : { description: now.description ?? null }),
        },
      },
      expect: {
        ...(payload.title === undefined ? {} : { title: payload.title }),
        ...(payload.description === undefined
          ? {}
          : { description: payload.description }),
      },
    };
  },
  async current(context, payload) {
    const now = await callAction(context, "goals.read", {
      id: String(payload.id),
    });
    return {
      ...(payload.title === undefined ? {} : { title: now.title }),
      ...(payload.description === undefined
        ? {}
        : { description: now.description ?? null }),
    };
  },
};

/**
 * Moving a task to another status (plan 0.9.0 L4a).
 *
 * The model picks the task by number and writes the status. Undo moves it
 * back to the status it had. `tasks.move` puts a card at the top of its
 * column when no slot is given, so an undone move lands at the top of the old
 * column rather than at its old slot. That is accepted: the slot is a
 * fraction nobody reads, and storing it would make undo refuse after any
 * unrelated move in the same column.
 */
const moveTask: ProposableAction = {
  action: "tasks.move",
  label: "Move a task to another status",
  whatItDoes:
    "Moves one of the person's tasks to another status: backlog, to do, in progress or done.",
  authored: z.object({
    /** One-based, into the `tasks` list the model was shown. */
    taskNumber: z.number().int().min(1),
    status: z.enum(TASK_STATUSES),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  fields: {
    type: "object",
    additionalProperties: false,
    required: ["taskNumber", "status"],
    properties: {
      taskNumber: { type: "integer", minimum: 1 },
      status: { type: "string", enum: [...TASK_STATUSES] },
    },
  },
  async offer(scope) {
    return { tasks: await scope.editableTasks() };
  },
  async build(_context, fields, choices) {
    const authored = fields as {
      taskNumber: number;
      status: (typeof TASK_STATUSES)[number];
    };
    const task = picked(choices, "tasks", authored.taskNumber);
    const from = carried(task, "status");
    if (from === authored.status) {
      throw new Error("The task is already there.");
    }
    return {
      action: "tasks.move",
      payload: { id: task.id, status: authored.status },
      preview: [
        { label: "Task", value: carried(task, "title") },
        {
          label: "Status",
          value: `${TASK_STATUS_WORD[from] ?? from} -> ${TASK_STATUS_WORD[authored.status] ?? authored.status}`,
        },
      ],
      subjectType: "task",
      subjectId: task.id,
    };
  },
  reverse() {
    return null;
  },
  async capture(context, payload) {
    const id = String(payload.id);
    const now = await callAction(context, "tasks.read", { id });
    return {
      reverse: { action: "tasks.move", payload: { id, status: now.status } },
      expect: { status: payload.status },
    };
  },
  async current(context, payload) {
    const now = await callAction(context, "tasks.read", {
      id: String(payload.id),
    });
    return { status: now.status };
  },
};

/**
 * Changing an initiative's status (plan 0.9.0 L4a).
 *
 * Undo sends the old status with `read` set to the status the edit left, so
 * the action's own conflict guard refuses a status somebody changed since, in
 * addition to the check undo makes first.
 */
const changeInitiativeStatus: ProposableAction = {
  action: "initiatives.update",
  label: "Change an initiative's status",
  whatItDoes:
    "Changes the status of one initiative the person may edit: planned, active, done or dropped.",
  authored: z.object({
    /** One-based, into the `initiatives` list the model was shown. */
    initiativeNumber: z.number().int().min(1),
    status: z.enum(INITIATIVE_STATUSES),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  fields: {
    type: "object",
    additionalProperties: false,
    required: ["initiativeNumber", "status"],
    properties: {
      initiativeNumber: { type: "integer", minimum: 1 },
      status: { type: "string", enum: [...INITIATIVE_STATUSES] },
    },
  },
  async offer(scope) {
    return { initiatives: await scope.editableInitiatives() };
  },
  async build(_context, fields, choices) {
    const authored = fields as {
      initiativeNumber: number;
      status: (typeof INITIATIVE_STATUSES)[number];
    };
    const initiative = picked(
      choices,
      "initiatives",
      authored.initiativeNumber,
    );
    const from = carried(initiative, "status");
    if (from === authored.status) {
      throw new Error("The initiative is already there.");
    }
    return {
      action: "initiatives.update",
      payload: { id: initiative.id, status: authored.status },
      preview: [
        { label: "Initiative", value: carried(initiative, "title") },
        {
          label: "Status",
          value: `${INITIATIVE_STATUS_WORD[from] ?? from} -> ${INITIATIVE_STATUS_WORD[authored.status] ?? authored.status}`,
        },
      ],
      subjectType: "initiative",
      subjectId: initiative.id,
    };
  },
  reverse() {
    return null;
  },
  async capture(context, payload) {
    const id = String(payload.id);
    const now = await callAction(context, "initiatives.read", { id });
    return {
      reverse: {
        action: "initiatives.update",
        payload: {
          id,
          status: now.status,
          read: { status: payload.status },
        },
      },
      expect: { status: payload.status },
    };
  },
  async current(context, payload) {
    const now = await callAction(context, "initiatives.read", {
      id: String(payload.id),
    });
    return { status: now.status };
  },
};

const OPEN_DRAFT_REFUSAL =
  "You already have a draft check-in on this objective. Finish or discard it first.";

/**
 * Whether the asking member has an open draft check-in on a goal, read through
 * `goals.checkIns` as the member. `goals.publishDraftedCheckIn` reuses an
 * author's open draft, so proposing over one would publish what the person
 * had been writing, and a person's draft is never touched.
 */
async function hasOpenDraft(
  context: ActionCallContext,
  goalId: string,
): Promise<boolean> {
  const memberId = await askingMember(context);
  const { checkIns } = await callAction(context, "goals.checkIns", {
    goalId,
    includeDrafts: true,
  });
  return checkIns.some(
    (entry) => entry.state === "draft" && entry.author.id === memberId,
  );
}

const CHECK_IN_STATUS_WORD: Readonly<Record<string, string>> = {
  on_track: "On track",
  caution: "Caution",
  off_track: "Off track",
};

/**
 * Checking in on an objective (plan 0.9.0 L4c).
 *
 * The model writes the status, an overall confidence, the narrative and, for
 * the key results the person gave a number for, a value and a confidence. It
 * picks the objective and each key result by number. A key result must sit
 * under the objective picked, so a number that points somewhere else is
 * refused rather than written onto another objective.
 *
 * **One action, no draft to supply.** `goals.publishDraftedCheckIn` opens the
 * author's own draft and publishes it as the member in one step, which is what
 * a proposal row can hold (it keeps one action and one payload). The preview
 * reads `64.6 -> 65` for each value, with the old value read when the model
 * was offered the list.
 *
 * **Undo is `goals.deleteCheckIn`, only while this is still the latest.** That
 * action rolls the goal back only for the latest check-in and does not check
 * it itself, so `expect` holds this check-in's id and undo refuses once a
 * newer one is the latest. Only metric and maintain key results are offered:
 * a milestone is checked in as done, not as a number.
 */
const checkIn: ProposableAction = {
  action: "goals.publishDraftedCheckIn",
  label: "Check in on an objective",
  whatItDoes:
    "Publishes a check-in on one objective the person may edit: a status, an overall confidence from 0 to 1, a narrative and, only where the person gave a number, a key result's new value and confidence from 0 to 1.",
  authored: z.object({
    /** One-based, into the `objectives` list the model was shown. */
    objectiveNumber: z.number().int().min(1),
    checkInStatus: z.enum(CHECK_IN_STATUSES),
    confidence: z.number().min(0).max(1),
    narrative: z.string().trim().min(1).max(2000),
    keyResultValues: z
      .array(
        z.object({
          /** One-based, into the `keyResults` list the model was shown. */
          keyResultNumber: z.number().int().min(1),
          value: z.number().finite().nullable().optional(),
          confidence: z.number().min(0).max(1).nullable().optional(),
        }),
      )
      .max(8)
      .optional(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  fields: {
    type: "object",
    additionalProperties: false,
    required: ["objectiveNumber", "checkInStatus", "confidence", "narrative"],
    properties: {
      objectiveNumber: { type: "integer", minimum: 1 },
      checkInStatus: { type: "string", enum: [...CHECK_IN_STATUSES] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      narrative: { type: "string", maxLength: 2000 },
      keyResultValues: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["keyResultNumber", "value", "confidence"],
          properties: {
            keyResultNumber: { type: "integer", minimum: 1 },
            value: { anyOf: [{ type: "number" }, { type: "null" }] },
            confidence: {
              anyOf: [
                { type: "number", minimum: 0, maximum: 1 },
                { type: "null" },
              ],
            },
          },
        },
      },
    },
  },
  async offer(scope) {
    return {
      objectives: await scope.editableObjectives(),
      keyResults: await scope.checkInKeyResults(),
    };
  },
  async build(context, fields, choices) {
    const authored = fields as {
      objectiveNumber: number;
      checkInStatus: (typeof CHECK_IN_STATUSES)[number];
      confidence: number;
      narrative: string;
      keyResultValues?: {
        keyResultNumber: number;
        value?: number | null;
        confidence?: number | null;
      }[];
    };
    const objective = picked(choices, "objectives", authored.objectiveNumber);
    if (await hasOpenDraft(context, objective.id)) {
      throw new Error(OPEN_DRAFT_REFUSAL);
    }
    const seen = new Set<string>();
    const values: {
      keyResultId: string;
      value?: number;
      confidence?: number;
    }[] = [];
    const rows: { label: string; value: string }[] = [];
    for (const entry of authored.keyResultValues ?? []) {
      const keyResult = picked(choices, "keyResults", entry.keyResultNumber);
      if (carried(keyResult, "goalId") !== objective.id) {
        // A number that points at another objective's key result. Refused
        // rather than written onto an objective nobody checked in on.
        throw new Error("That key result is not under that objective.");
      }
      if (seen.has(keyResult.id)) {
        throw new Error("A key result is listed twice.");
      }
      seen.add(keyResult.id);
      const value = entry.value ?? undefined;
      const confidence = entry.confidence ?? undefined;
      if (value === undefined && confidence === undefined) {
        continue;
      }
      values.push({
        keyResultId: keyResult.id,
        ...(value === undefined ? {} : { value }),
        ...(confidence === undefined ? {} : { confidence }),
      });
      const shown = [
        ...(value === undefined
          ? []
          : [`${carried(keyResult, "current")} -> ${value}`]),
        ...(confidence === undefined ? [] : [`confidence ${confidence}`]),
      ];
      rows.push({
        label: carried(keyResult, "title"),
        value: shown.join(", "),
      });
    }
    return {
      action: "goals.publishDraftedCheckIn",
      payload: {
        goalId: objective.id,
        status: authored.checkInStatus,
        confidence: authored.confidence,
        narrative: richTextFromPlainText(authored.narrative),
        values,
      },
      preview: [
        { label: "Objective", value: objective.label },
        {
          label: "Status",
          value:
            CHECK_IN_STATUS_WORD[authored.checkInStatus] ??
            authored.checkInStatus,
        },
        { label: "Confidence", value: String(authored.confidence) },
        { label: "Narrative", value: authored.narrative },
        ...rows,
      ],
      subjectType: "goal",
      subjectId: objective.id,
    };
  },
  reverse() {
    return null;
  },
  async capture(context, payload) {
    // A draft that appeared since the proposal was made is the person's, and
    // applying would publish it. Refused before the action runs.
    if (await hasOpenDraft(context, String(payload.goalId))) {
      throw new OperationError("forbidden", OPEN_DRAFT_REFUSAL);
    }
    // Nothing else to read first: undo deletes the check-in this creates, and its
    // id is known only once it exists, in `settle`. `expect` is what the
    // check-in holds when it is published, so undo refuses a check-in a person
    // edited or a reviewer acknowledged since.
    const values = (payload.values ?? []) as {
      keyResultId: string;
      value?: number;
      confidence?: number;
    }[];
    return {
      reverse: { action: "goals.deleteCheckIn", payload: {} },
      expect: {
        status: payload.status,
        confidence: payload.confidence,
        narrative: narrativeLine(payload.narrative),
        acknowledgedAt: null,
        values: Object.fromEntries(
          values.map((entry) => [
            entry.keyResultId,
            {
              ...(entry.value === undefined ? {} : { value: entry.value }),
              ...(entry.confidence === undefined
                ? {}
                : { confidence: entry.confidence }),
            },
          ]),
        ),
      },
    };
  },
  settle(captured, result) {
    const id = result.id;
    if (typeof id !== "string") {
      return null;
    }
    return {
      reverse: { ...captured.reverse, payload: { id } },
      expect: { ...captured.expect, latestCheckInId: id },
    };
  },
  async current(context, payload) {
    const { checkIns } = await callAction(context, "goals.checkIns", {
      goalId: String(payload.goalId),
      includeDrafts: false,
    });
    const latest = checkIns[0];
    if (!latest) {
      return { latestCheckInId: null };
    }
    // Only the key results this check-in wrote, read from the snapshot of
    // whatever the latest check-in holds now.
    const wrote = (
      (payload.values ?? []) as {
        keyResultId: string;
        value?: number;
        confidence?: number;
      }[]
    ).map((entry) => entry.keyResultId);
    const values = Object.fromEntries(
      wrote.map((keyResultId) => {
        const entry = latest.entries.find(
          (candidate) => candidate.keyResultId === keyResultId,
        );
        const written = (
          payload.values as {
            keyResultId: string;
            value?: number;
            confidence?: number;
          }[]
        ).find((candidate) => candidate.keyResultId === keyResultId);
        return [
          keyResultId,
          {
            ...(written?.value === undefined
              ? {}
              : { value: entry?.value ?? null }),
            ...(written?.confidence === undefined
              ? {}
              : { confidence: entry?.confidence ?? null }),
          },
        ];
      }),
    );
    return {
      latestCheckInId: latest.id,
      status: latest.status,
      confidence: latest.confidence,
      narrative: narrativeLine(latest.narrative),
      acknowledgedAt: latest.acknowledgedAt,
      values,
    };
  },
};

/** A narrative as the one line two readings of it compare on. */
function narrativeLine(narrative: unknown): string {
  if (typeof narrative !== "object" || narrative === null) {
    return "";
  }
  try {
    return excerptRichText(narrative as RichTextDocument, 2000);
  } catch {
    return "";
  }
}

/** How many periods `kpis.detail` is asked for when looking up one. */
const KPI_PERIOD_WINDOW = 48;

/** One KPI's period, and the value it holds now, or null when it has none. */
interface KpiPeriod {
  readonly periodStart: string;
  readonly record: {
    readonly actualValue: number | null;
    readonly remark: string | null;
  } | null;
}

/**
 * The record a date's period holds, read as the member.
 *
 * `kpis.detail` returns the newest periods only. A period older than the
 * oldest it returned might hold a value this cannot see, and treating that as
 * "no value" would make undo delete what was there before, so it is refused.
 */
async function kpiPeriod(
  context: ActionCallContext,
  kpiId: string,
  on: string,
): Promise<KpiPeriod> {
  const detail = await callAction(context, "kpis.detail", {
    kpiId,
    periods: KPI_PERIOD_WINDOW,
  });
  const periodStart = normalisePeriod(detail.kpi.frequency as KpiFrequency, on);
  const found = detail.records.find(
    (entry) => entry.periodStart === periodStart,
  );
  const oldest = detail.records[detail.records.length - 1]?.periodStart ?? "";
  if (
    !found &&
    detail.records.length >= KPI_PERIOD_WINDOW &&
    oldest > periodStart
  ) {
    throw new Error("That period is too far back to propose a value for.");
  }
  return {
    periodStart,
    record: found
      ? { actualValue: found.actualValue, remark: found.remark }
      : null,
  };
}

/** True for a date that exists on the calendar, not only one that is shaped like it. */
function isCalendarDate(value: string): boolean {
  if (!LOCAL_DATE_PATTERN.test(value)) {
    return false;
  }
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

/**
 * Recording a KPI's value for a period (plan 0.9.0 L4c).
 *
 * The model writes a date inside the period, the actual value and, if the
 * person said one, a remark. It picks the KPI by number from the ones this
 * member may edit, calculated KPIs left out because `kpis.record` refuses
 * them. The model is told today's date, because "this month" means nothing
 * without it.
 *
 * **Undo depends on what the period held.** With a value before, undo records
 * that value again. With none, undo removes the one this recorded
 * (`kpis.deleteRecord`, which is never proposable and exists for this). Either
 * way `expect` holds the value this recorded and undo is refused when the
 * period no longer holds it, so a figure somebody typed after is never removed
 * or overwritten.
 */
const recordKpiValue: ProposableAction = {
  action: "kpis.record",
  label: "Record a KPI value",
  whatItDoes:
    "Records the actual value of one KPI the person may edit for one period. periodDate is any date inside that period, written YYYY-MM-DD. A value already recorded for that period is replaced.",
  authored: z.object({
    /** One-based, into the `kpis` list the model was shown. */
    kpiNumber: z.number().int().min(1),
    periodDate: z.string().refine(isCalendarDate, "not a calendar date"),
    actualValue: z.number().finite(),
    remark: z.string().trim().max(500).optional(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  fields: {
    type: "object",
    additionalProperties: false,
    required: ["kpiNumber", "periodDate", "actualValue"],
    properties: {
      kpiNumber: { type: "integer", minimum: 1 },
      periodDate: { type: "string", maxLength: 10 },
      actualValue: { type: "number" },
      remark: { type: "string", maxLength: 500 },
    },
  },
  async offer(scope) {
    return { kpis: await scope.editableKpis() };
  },
  async note(scope) {
    return `Today is ${await scope.today()}.`;
  },
  async build(context, fields, choices) {
    const authored = fields as {
      kpiNumber: number;
      periodDate: string;
      actualValue: number;
      remark?: string;
    };
    const kpi = picked(choices, "kpis", authored.kpiNumber);
    const period = await kpiPeriod(context, kpi.id, authored.periodDate);
    if (period.record?.actualValue === authored.actualValue) {
      // The period already holds it. No card rather than a change of nothing.
      throw new Error("That value is already recorded.");
    }
    const before =
      period.record?.actualValue === null ||
      period.record?.actualValue === undefined
        ? "(none)"
        : String(period.record.actualValue);
    return {
      action: "kpis.record",
      payload: {
        kpiId: kpi.id,
        on: period.periodStart,
        actualValue: authored.actualValue,
        ...(authored.remark ? { remark: authored.remark } : {}),
      },
      preview: [
        { label: "KPI", value: carried(kpi, "title") },
        { label: "Period", value: period.periodStart },
        { label: "Value", value: `${before} -> ${authored.actualValue}` },
        ...(authored.remark
          ? [{ label: "Remark", value: authored.remark }]
          : []),
      ],
      subjectType: "kpi",
      subjectId: kpi.id,
    };
  },
  reverse() {
    return null;
  },
  async capture(context, payload) {
    const kpiId = String(payload.kpiId);
    const wroteRemark = payload.remark !== undefined;
    let period: KpiPeriod;
    try {
      period = await kpiPeriod(context, kpiId, String(payload.on));
    } catch {
      // A period too far back to see what it held: no undo, said on the card.
      return null;
    }
    // The remark is always compared, even when the copilot wrote none: a
    // remark a person adds afterwards by recording the period again would
    // otherwise be removed with the value by an undo. When it wrote none, the
    // remark the period already held is what it leaves.
    const expect: Fields = {
      actualValue: payload.actualValue,
      remark: wroteRemark ? payload.remark : (period.record?.remark ?? null),
    };
    if (period.record === null) {
      // Nothing there before. The new record's id is known in `settle`.
      return { reverse: { action: "kpis.deleteRecord", payload: {} }, expect };
    }
    return {
      reverse: {
        action: "kpis.record",
        payload: {
          kpiId,
          on: period.periodStart,
          actualValue: period.record.actualValue,
          ...(wroteRemark ? { remark: period.record.remark } : {}),
        },
      },
      expect,
    };
  },
  settle(captured, result) {
    if (captured.reverse.action !== "kpis.deleteRecord") {
      return captured;
    }
    const id = result.id;
    return typeof id === "string"
      ? {
          reverse: { ...captured.reverse, payload: { id } },
          expect: captured.expect,
        }
      : null;
  },
  async current(context, payload) {
    const period = await kpiPeriod(
      context,
      String(payload.kpiId),
      String(payload.on),
    );
    return {
      actualValue: period.record?.actualValue ?? null,
      remark: period.record?.remark ?? null,
    };
  },
};

/** Every action the copilot may propose, by registry name. */
export const PROPOSABLE_ACTIONS: readonly ProposableAction[] = [
  createObjective,
  addKeyResult,
  startInitiative,
  addTask,
  editObjective,
  moveTask,
  changeInitiativeStatus,
  checkIn,
  recordKpiValue,
];

/** How many objectives or key results a model is shown at once. */
const CHOICE_LIMIT = 40;

/**
 * The lists the offers are built from, each read once per request.
 *
 * Three entries share the same objectives and key results, and reading them
 * three times would be three copies of the same access decision that could
 * disagree if a binding changed between them.
 */
interface OfferScope {
  editableSpaces(): Promise<NumberedChoice[]>;
  editableObjectives(): Promise<NumberedChoice[]>;
  /** Key results new work may be tied to, in spaces the member may edit. */
  workKeyResults(): Promise<NumberedChoice[]>;
  /** The member's own tasks they may edit, with their status in the label. */
  editableTasks(): Promise<NumberedChoice[]>;
  /** Initiatives the member may edit, with their status in the label. */
  editableInitiatives(): Promise<NumberedChoice[]>;
  /**
   * Metric and maintain key results under the editable objectives, with the
   * value they hold now beside the label.
   */
  checkInKeyResults(): Promise<NumberedChoice[]>;
  /** Non-calculated KPIs, when the member's role lets them record values. */
  editableKpis(): Promise<NumberedChoice[]>;
  /** Today in the workspace's calendar, as YYYY-MM-DD. */
  today(): Promise<string>;
}

function offerScope(context: ActionCallContext): OfferScope {
  const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
    let pending: Promise<T> | undefined;
    return () => {
      pending ??= load();
      return pending;
    };
  };

  /** The subset of `ids` this member may change, by the access model. */
  const editable = async (
    resourceType: "space" | "goal" | "task" | "initiative",
    ids: readonly string[],
  ): Promise<Set<string>> => {
    if (ids.length === 0) {
      return new Set();
    }
    const memberId = await askingMember(context);
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId: context.actor.userId ?? "" },
      (tx) =>
        visibleResourceIds(tx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType,
          ids,
          requires: ACCESS_LEVELS.edit,
        }),
    );
  };

  const spaces = once(async () => {
    const listed = await callAction(context, "spaces.list", {});
    const allowed = await editable(
      "space",
      listed.map((space) => space.id),
    );
    return listed
      .filter((space) => allowed.has(space.id))
      .map((space) => ({ id: space.id, label: space.name }));
  });

  /** This quarter's open objectives the member may edit, with their cycle. */
  const objectives = once(async () => {
    const cycle = await callAction(context, "cycles.current", {
      mode: "quarterly",
    });
    if (!cycle) {
      return [];
    }
    const { goals } = await callAction(context, "goals.list", {
      cycleId: cycle.id,
      includeClosed: false,
      limit: CHOICE_LIMIT,
    });
    const allowed = await editable(
      "goal",
      goals.map((goal) => goal.id),
    );
    return goals
      .filter((goal) => allowed.has(goal.id))
      .map((goal) => ({ goal, cycleEndsOn: cycle.endsOn }));
  });

  const tasks = once(async () => {
    // Their own tasks: `tasks.list` has no limit, and a copilot asked to move
    // a task is almost always asked about work that is the asker's.
    const listed = await callAction(context, "tasks.list", { mine: true });
    const allowed = await editable(
      "task",
      listed.map((task) => task.id),
    );
    return (
      listed
        .filter((task) => allowed.has(task.id))
        // What is open first, so a cap never hides it behind finished work.
        .sort(
          (a, b) => Number(a.status === "done") - Number(b.status === "done"),
        )
        .slice(0, CHOICE_LIMIT)
        .map((task) => ({
          id: task.id,
          label: `${task.title} (${TASK_STATUS_WORD[task.status] ?? task.status}${task.keyResultTitle ? `, ${task.keyResultTitle}` : ""})`,
          with: { title: task.title, status: task.status },
        }))
    );
  });

  const initiatives = once(async () => {
    const listed = await callAction(context, "initiatives.list", {});
    const allowed = await editable(
      "initiative",
      listed.map((initiative) => initiative.id),
    );
    const closed = (status: string) =>
      status === "done" || status === "dropped";
    return listed
      .filter((initiative) => allowed.has(initiative.id))
      .sort((a, b) => Number(closed(a.status)) - Number(closed(b.status)))
      .slice(0, CHOICE_LIMIT)
      .map((initiative) => ({
        id: initiative.id,
        label: `${initiative.title} (${INITIATIVE_STATUS_WORD[initiative.status] ?? initiative.status}, ${initiative.spaceName})`,
        with: { title: initiative.title, status: initiative.status },
      }));
  });

  const kpiChoices = once(async () => {
    // KPIs sit at the workspace floor and `kpis.record` is measured on the
    // member's role for that domain, so the offer asks the same question.
    const level = await withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId: context.actor.userId ?? "" },
      (tx) =>
        writeFloorFor(tx as OperationTx, {
          workspaceId: context.workspaceId,
          actor: context.actor,
          domain: "kpi",
        }),
    );
    if (level < ACCESS_LEVELS.edit) {
      return [];
    }
    const { kpis } = await callAction(context, "kpis.list", {});
    return (
      kpis
        // `kpis.record` refuses a calculated KPI, so it is never offered.
        .filter((kpi) => !kpi.isCalculated)
        .slice(0, CHOICE_LIMIT)
        .map((kpi) => ({
          id: kpi.id,
          label: `${kpi.title} (${kpi.frequency}${kpi.unit ? `, ${kpi.unit}` : ""})`,
          with: { title: kpi.title, frequency: kpi.frequency },
        }))
    );
  });

  return {
    editableTasks: tasks,
    editableInitiatives: initiatives,
    editableKpis: kpiChoices,
    today: once(async () =>
      withContext(
        drizzle(context.pool),
        {
          workspaceId: context.workspaceId,
          userId: context.actor.userId ?? "",
        },
        async (tx) =>
          formatLocalDate(
            localDateIn(
              new Date(),
              await workspaceTimeZone(tx as OperationTx, context.workspaceId),
            ),
          ),
      ),
    ),
    checkInKeyResults: once(async () => {
      const choices: NumberedChoice[] = [];
      for (const { goal } of await objectives()) {
        for (const keyResult of goal.keyResults) {
          // A milestone is checked in as done and a baseline as recorded, not
          // as a number the model could write.
          if (keyResult.kind !== "metric" && keyResult.kind !== "maintain") {
            continue;
          }
          const unit = keyResult.unit ? ` ${keyResult.unit}` : "";
          choices.push({
            id: keyResult.id,
            label: `${keyResult.title} (${goal.title}, now ${keyResult.currentValue}${unit})`,
            with: {
              goalId: goal.id,
              title: keyResult.title,
              current: String(keyResult.currentValue),
            },
          });
          if (choices.length >= CHOICE_LIMIT) {
            return choices;
          }
        }
      }
      return choices;
    }),
    editableSpaces: spaces,
    editableObjectives: once(async () =>
      (await objectives()).map(({ goal, cycleEndsOn }) => ({
        id: goal.id,
        label: goal.title,
        with: { cycleEndsOn },
      })),
    ),
    workKeyResults: once(async () => {
      const inSpaces = new Set((await spaces()).map((space) => space.id));
      if (inSpaces.size === 0) {
        return [];
      }
      const choices: NumberedChoice[] = [];
      // I1's rule, which the screens' pickers use (plan 0.8.1 A1): every cycle
      // being planned or running, the running quarter first.
      const cycles = cyclesOpenForWork(
        await callAction(context, "cycles.list", {}),
      );
      for (const cycle of cycles) {
        // `goals.list` is access-filtered at view, which is all creating work
        // asks of a key result's objective (`assertWhatATaskNames`). Editing
        // the objective is not needed: work changes the space, not the goal.
        const { goals } = await callAction(context, "goals.list", {
          cycleId: cycle.id,
          includeClosed: false,
        });
        for (const goal of goals) {
          // Work lives in a space, and creating it asks edit there. An
          // objective owned by the workspace or by a person has nowhere to put
          // an initiative or a task without somebody choosing one, and
          // choosing is not the model's to do.
          if (goal.spaceId === null || !inSpaces.has(goal.spaceId)) {
            continue;
          }
          for (const keyResult of goal.keyResults) {
            choices.push({
              id: keyResult.id,
              label: `${keyResult.title} (${goal.title}, ${cycle.name})`,
              with: { goalId: goal.id, spaceId: goal.spaceId },
            });
            if (choices.length >= CHOICE_LIMIT) {
              return choices;
            }
          }
        }
      }
      return choices;
    }),
  };
}

/** Private: reversalFor and buildProposal below are the two ways in. */
const proposableAction = (action: string) =>
  PROPOSABLE_ACTIONS.find((entry) => entry.action === action);

/** The reverse of an applied proposal, or null when it has none. */
export function reversalFor(
  action: string,
  result: Record<string, unknown> | null,
): Reversal | null {
  const entry = proposableAction(action);
  if (!entry || !result) {
    return null;
  }
  return entry.reverse(result);
}

/** True for an action that is an edit, whose undo comes from `capture`. */
export function isEdit(action: string): boolean {
  return proposableAction(action)?.capture !== undefined;
}

/**
 * Reads the values from before an edit and builds the reverse, as the member.
 * Call it just before the action runs. Null for a create and for an edit that
 * cannot be put back.
 */
export async function captureReverse(
  context: ActionCallContext,
  action: string,
  payload: Record<string, unknown>,
): Promise<StoredReverse | null> {
  const entry = proposableAction(action);
  if (!entry?.capture) {
    return null;
  }
  const captured = await entry.capture(context, payload);
  return captured ? { ...captured.reverse, expect: captured.expect } : null;
}

/**
 * Completes a captured reverse with what the action returned, for an undo that
 * needs the id of what was created. Null when it cannot be completed, which
 * leaves the proposal applied with no undo, as a create with no reverse is.
 */
export function settleReverse(
  action: string,
  stored: StoredReverse,
  result: Record<string, unknown>,
): StoredReverse | null {
  const entry = proposableAction(action);
  if (!entry?.settle) {
    return stored;
  }
  const settled = entry.settle(
    {
      reverse: { action: stored.action, payload: stored.payload },
      expect: stored.expect,
    },
    result,
  );
  return settled ? { ...settled.reverse, expect: settled.expect } : null;
}

/** One spelling of a value, keys sorted, so two readings of it compare. */
function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Whether an applied edit's record no longer holds what the edit left.
 * True when it cannot be checked, because undoing blind is the one thing
 * this guard exists to prevent.
 */
export async function changedSinceApplied(
  context: ActionCallContext,
  action: string,
  payload: Record<string, unknown>,
  expect: Record<string, unknown>,
): Promise<boolean> {
  const entry = proposableAction(action);
  if (!entry?.current) {
    return true;
  }
  const now = await entry.current(context, payload);
  return Object.keys(expect).some(
    (key) => stable(expect[key]) !== stable(now[key]),
  );
}

/** The asking member, without a second copy of the actor resolution. */
async function askingMember(context: ActionCallContext): Promise<string> {
  const { askingMemberId } = await import("../actions/copilot.ts");
  return askingMemberId(context);
}

/**
 * What the model is offered, resolved for this member's own editable data.
 *
 * **An action whose list came back empty is not offered.** A model shown an
 * empty list of objectives can only miscount into it, and a member who may
 * edit no objective has no key result to add to one.
 */
export async function proposalOffers(
  context: ActionCallContext,
): Promise<readonly ProposalOffer[]> {
  const scope = offerScope(context);
  const offers: ProposalOffer[] = [];
  for (const entry of PROPOSABLE_ACTIONS) {
    const choices = await entry.offer(scope);
    if (Object.values(choices).some((list) => list.length === 0)) {
      continue;
    }
    const note = entry.note ? ` ${await entry.note(scope)}` : "";
    offers.push({
      action: entry.action,
      label: entry.label,
      whatItDoes: `${entry.whatItDoes}${note}`,
      fields: entry.fields,
      choices,
    });
  }
  return offers;
}

/**
 * Validates what the model authored and builds the real payload.
 *
 * Throws when the action is not on the list or the fields do not match its
 * schema. Both are the same failure from a reviewer's point of view, which is
 * that there is nothing to review.
 */
export async function buildProposal(
  context: ActionCallContext,
  authored: AuthoredProposal,
  offers: readonly ProposalOffer[],
): Promise<BuiltProposal> {
  const entry = proposableAction(authored.action);
  if (!entry) {
    throw new Error(
      `${authored.action} is not an action the copilot may propose.`,
    );
  }
  const fields = entry.authored.parse(authored.fields);
  const offer = offers.find(
    (candidate) => candidate.action === authored.action,
  );
  return entry.build(context, fields, offer?.choices ?? {});
}

/**
 * Asks the copilot for a proposal, and records it if there is one.
 *
 * A plain function for the same reason `answerQuestion` is: the model call must
 * not happen inside a write's transaction, and both registered writes it uses
 * are in the contract registry.
 *
 * **Null is the ordinary answer.** Most sentences are questions, not requests to
 * change something, and a copilot that proposed something for every one of them
 * would be a copilot nobody trusts with the apply button. Null also covers the
 * provider being off, the model naming an action outside the list, and fields
 * the schema refuses: from a reviewer's point of view all four are the same, in
 * that there is nothing to review. From an operator's they are not, so every
 * one but a plain decline writes a log line naming why (plan 0.8.1 A3).
 */
export async function proposeFromRequest(
  context: ActionCallContext,
  input: { readonly threadId: string; readonly request: string },
  /** Already read by the caller, so they are not read twice (plan 0.8.1 W2). */
  preparedOffers?: readonly ProposalOffer[],
): Promise<{
  readonly id: string;
  readonly action: string;
  readonly preview: BuiltProposal["preview"];
  readonly why: string;
} | null> {
  const drafter = context.drafter;
  if (!drafter?.proposeAction) {
    return null;
  }

  const offers = preparedOffers ?? (await proposalOffers(context));
  if (offers.length === 0) {
    return null;
  }

  // Every null below names its reason in the log, except a plain decline
  // (plan 0.8.1 A3). The drafter reports the ones it decides; this function
  // reports the two it decides itself.
  const dropped = (drop: ProposalDrop) =>
    logProposalDrop(drop, drafter.identity);

  let authored: Awaited<ReturnType<NonNullable<typeof drafter.proposeAction>>> =
    null;
  try {
    authored = await drafter.proposeAction({
      onDropped: dropped,
      request: input.request,
      // Labels only. No identifier reaches the model.
      options: offers.map((offer) => ({
        action: offer.action,
        label: offer.label,
        whatItDoes: offer.whatItDoes,
        fields: offer.fields,
        choices: Object.fromEntries(
          Object.entries(offer.choices).map(([key, list]) => [
            key,
            list.map((choice) => choice.label),
          ]),
        ),
      })),
      sources: [],
    });
  } catch (error) {
    // The provider drafter catches its own failures and reports them; a host's
    // drafter that throws instead is reported here.
    dropped({
      reason: "provider_error",
      action: null,
      errorName: errorNameOf(error),
    });
    return null;
  }
  if (!authored) {
    return null;
  }

  let built: BuiltProposal;
  try {
    built = await buildProposal(context, authored, offers);
  } catch {
    // A model that named an action outside the list, wrote a field the schema
    // refuses, or indexed past the end of a list it was shown. No proposal,
    // rather than a proposal built on a guess.
    dropped({ reason: "build_refused", action: authored.action });
    return null;
  }

  const recorded = await callAction(context, "copilot.recordProposal", {
    threadId: input.threadId,
    action: built.action,
    payload: built.payload,
    preview: [...built.preview],
    why: authored.why,
    subjectType: built.subjectType,
    subjectId: built.subjectId,
  });

  return {
    id: recorded.id,
    action: built.action,
    preview: built.preview,
    why: authored.why,
  };
}

/**
 * Asks for the proposal before the answer, and says what came of it (plan
 * 0.8.1 A2, decided by Akmal on 12 November 2026: the proposal first).
 *
 * The answer used to be written beside the proposal and could only guess: it
 * said "I cannot create objectives" above a working card. The cost is the time
 * of one short structured call before the first word, one to three seconds on
 * GPT-6 Luna, which the panel shows as a step.
 *
 * **Never throws.** A proposal is the smaller half of the turn, and an answer
 * must not be lost to it: anything going wrong is no card.
 */
export async function proposeBeforeAnswering(
  context: ActionCallContext,
  input: { readonly threadId: string; readonly request: string },
  /**
   * From `offersToPropose`, so the caller can say it is preparing a change
   * only when it really will ask a model for one (plan 0.8.1 W2). Null means
   * nothing can be proposed, and no model is asked.
   */
  offers: readonly ProposalOffer[] | null,
): Promise<{
  readonly note: ProposalNote;
  readonly proposalId: string | null;
}> {
  let proposed: Awaited<ReturnType<typeof proposeFromRequest>> = null;
  if (offers !== null) {
    try {
      proposed = await proposeFromRequest(context, input, offers);
    } catch {
      proposed = null;
    }
  }
  if (!proposed) {
    return { note: { made: false }, proposalId: null };
  }
  return {
    note: proposalNoteFor(proposed.action, proposed.preview),
    proposalId: proposed.id,
  };
}

/**
 * What the answer is told about a card that exists. One place for both ways a
 * card is made: the proposal-first call above and the `propose_change` tool
 * (plan 0.9.0 A4).
 */
export function proposalNoteFor(
  action: string,
  preview: BuiltProposal["preview"],
): Extract<ProposalNote, { made: true }> {
  return {
    made: true,
    label: proposableAction(action)?.label ?? action,
    preview,
  };
}

/**
 * What this member may be offered, or null when no proposal will be asked for:
 * no drafter that proposes, or nothing the member may change (plan 0.8.1 W2).
 * Never throws; a failure to read is no proposal.
 */
export async function offersToPropose(
  context: ActionCallContext,
): Promise<readonly ProposalOffer[] | null> {
  if (!context.drafter?.proposeAction) {
    return null;
  }
  try {
    const offers = await proposalOffers(context);
    return offers.length === 0 ? null : offers;
  } catch {
    return null;
  }
}
