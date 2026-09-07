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
 * propose any registered write is a copilot that may propose
 * `people.erase`. One entry proves the whole path, and the shape below is what
 * makes adding the second entry a small change rather than a redesign.
 *
 * **Every entry declares its own reverse, or admits it has none.** A proposal
 * that cannot be undone is still applicable; the interface says so instead of
 * offering a button that does nothing.
 */
import { z } from "zod";
import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";
import { richTextFromPlainText } from "../rich-text/from-text.ts";

/** One thing the model may be shown and point at by number. */
export interface NumberedChoice {
  readonly id: string;
  readonly label: string;
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
  offer(context: ActionCallContext): Promise<ProposalOffer["choices"]>;
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
  async offer(context) {
    const spaces = await callAction(context, "spaces.list", {});
    return {
      spaces: spaces.map((space) => ({ id: space.id, label: space.name })),
    };
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

/** Every action the copilot may propose, by registry name. */
export const PROPOSABLE_ACTIONS: readonly ProposableAction[] = [
  createObjective,
];

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

/** What the model is offered, resolved for this member's own readable data. */
export async function proposalOffers(
  context: ActionCallContext,
): Promise<readonly ProposalOffer[]> {
  const offers: ProposalOffer[] = [];
  for (const entry of PROPOSABLE_ACTIONS) {
    offers.push({
      action: entry.action,
      label: entry.label,
      whatItDoes: entry.whatItDoes,
      fields: entry.fields,
      choices: await entry.offer(context),
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
