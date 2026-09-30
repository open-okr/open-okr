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
 * filtered through the access model at `edit` before the model sees it, so a
 * space, an objective or a key result the member may only read is not on the
 * list to be pointed at. Applying still runs the action as the member, whose
 * own authorisation decides again: the offer narrows what can be proposed, the
 * action decides what can be done.
 *
 * **Every entry declares its own reverse, or admits it has none.** A proposal
 * that cannot be undone is still applicable; the interface says so instead of
 * offering a button that does nothing.
 */
import {
  INDICATOR_TYPES,
  KEY_RESULT_DIRECTIONS,
  withContext,
} from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { visibleResourceIds } from "../access/reads.ts";
import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";
import { richTextFromPlainText } from "../rich-text/from-text.ts";

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
  /** The reverse, given what applying it returned. */
  reverse(result: Record<string, unknown>): Reversal | null;
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
      },
      preview: [
        { label: "Objective", value: authored.title },
        ...(authored.description
          ? [{ label: "Description", value: authored.description }]
          : []),
        { label: "Level", value: authored.level },
        { label: "Space", value: space.label },
        { label: "Cycle", value: cycle.name },
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
      },
      preview: [
        { label: "Key result", value: authored.title },
        { label: "Objective", value: objective.label },
        { label: "Baseline", value: measure(authored.baseline) },
        { label: "Target", value: measure(authored.target) },
        { label: "Direction", value: authored.direction },
        { label: "Indicator", value: authored.indicatorType },
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
    return { keyResults: await scope.editableKeyResults() };
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
    return { keyResults: await scope.editableKeyResults() };
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

/** Every action the copilot may propose, by registry name. */
export const PROPOSABLE_ACTIONS: readonly ProposableAction[] = [
  createObjective,
  addKeyResult,
  startInitiative,
  addTask,
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
  editableKeyResults(): Promise<NumberedChoice[]>;
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
    resourceType: "space" | "goal",
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

  return {
    editableSpaces: spaces,
    editableObjectives: once(async () =>
      (await objectives()).map(({ goal, cycleEndsOn }) => ({
        id: goal.id,
        label: goal.title,
        with: { cycleEndsOn },
      })),
    ),
    editableKeyResults: once(async () => {
      const inSpaces = new Set((await spaces()).map((space) => space.id));
      const choices: NumberedChoice[] = [];
      for (const { goal } of await objectives()) {
        // Work lives in a space. An objective owned by the workspace or by a
        // person has nowhere to put an initiative or a task without somebody
        // choosing one, and choosing is not the model's to do.
        if (goal.spaceId === null || !inSpaces.has(goal.spaceId)) {
          continue;
        }
        for (const keyResult of goal.keyResults) {
          choices.push({
            id: keyResult.id,
            label: `${keyResult.title} (${goal.title})`,
            with: { goalId: goal.id, spaceId: goal.spaceId },
          });
        }
      }
      return choices.slice(0, CHOICE_LIMIT);
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
    offers.push({
      action: entry.action,
      label: entry.label,
      whatItDoes: entry.whatItDoes,
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
 * that there is nothing to review.
 */
export async function proposeFromRequest(
  context: ActionCallContext,
  input: { readonly threadId: string; readonly request: string },
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

  const offers = await proposalOffers(context);
  if (offers.length === 0) {
    return null;
  }

  let authored: Awaited<ReturnType<NonNullable<typeof drafter.proposeAction>>> =
    null;
  try {
    authored = await drafter.proposeAction({
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
  } catch {
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
