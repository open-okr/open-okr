/**
 * The proposal as one of the read loop's tools (plan 0.9.0 A4,
 * docs/design/copilot-live-data.md section 11).
 *
 * Before this, every question paid for a separate structured model call that
 * decided whether the sentence asked for a change. Now the model that is
 * already choosing reads may call `propose_change` in the same round, and a
 * question that asks for nothing never makes the call.
 *
 * **The tool is the same proposal, checked by the same code.** The arguments
 * go through `buildProposal` and are stored with `copilot.recordProposal`,
 * exactly as `proposeFromRequest` does after its own model call. A refusal
 * comes back as a sentence the model can read, and no card is made.
 *
 * **Only the member's own words may start it** (A4-D4). The rule is not a
 * prompt instruction. The drafter offers the tool in round one only, when the
 * model has seen the system prompt, the member's question and the earlier
 * questions of the thread, and no read result. This file refuses a call that
 * arrives in any later round as an unknown tool, in case a provider sends
 * one it was not offered.
 */

import { isDeepStrictEqual } from "node:util";
import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";
import type { ProposalDropReason, ReadingTool } from "../agents/drafter.ts";
import { logProposalDrop } from "./proposal-drops.ts";
import {
  type BuiltProposal,
  buildProposal,
  type ProposalOffer,
} from "./proposals.ts";
import type { ReadResult } from "./read-tools.ts";

/** The tool's name. One word with an underscore, because providers refuse a dot. */
export const PROPOSE_TOOL = "propose_change";

/** What the model reads back, by outcome. */
export const PROPOSAL_MADE_TEXT =
  "The change was prepared as a card. The person reviews it and applies it themselves. It is not applied yet.";
export const PROPOSAL_ALREADY_TEXT =
  "A change was already proposed in this answer.";
const NOT_AVAILABLE_TEXT = "That tool is not available.";

/** Why a call could not be prepared, in words for the model. Never the request. */
const REFUSED_BECAUSE: Readonly<Record<ProposalDropReason, string>> = {
  declined: "nothing was proposed",
  not_offered: "that action is not on the list",
  no_reason: "no reason was given",
  fields_refused:
    "a field was missing or a choice was not one of those offered",
  build_refused: "a field was missing or a choice was not one of those offered",
  provider_error: "it could not be saved",
};

const refusedText = (reason: ProposalDropReason) =>
  `That change could not be prepared: ${REFUSED_BECAUSE[reason]}.`;

type JsonSchema = Record<string, unknown>;

/**
 * Any of these shapes, or null. `anyOf` with a null branch and never a type
 * list, for the reason the drafter's own proposal schema gives: Anthropic's
 * structured output refuses `type: ["string", "null"]` beside an `enum`.
 */
const nullable = (shapes: readonly JsonSchema[]): JsonSchema => ({
  anyOf: [...shapes, { type: "null" }],
});

/**
 * The input schema, built from what this member may be offered.
 *
 * **Every object closed and every property required**, the only shape strict
 * structured output accepts and fills. One `fields` object holds every field
 * any offered action takes, each nullable: a field the chosen action does not
 * take is null and is dropped below. The shapes come from the offers, so this
 * file holds no copy of any action's fields.
 */
function proposeToolSchema(offers: readonly ProposalOffer[]): JsonSchema {
  const fields: Record<string, JsonSchema[]> = {};
  for (const offer of offers) {
    const properties = (offer.fields.properties ?? {}) as Record<
      string,
      JsonSchema
    >;
    for (const [name, field] of Object.entries(properties)) {
      const seen = fields[name] ?? [];
      if (!seen.some((known) => isDeepStrictEqual(known, field))) {
        seen.push(field);
      }
      fields[name] = seen;
    }
  }
  const names = Object.keys(fields).sort();
  return {
    type: "object",
    additionalProperties: false,
    required: ["action", "fields", "why"],
    properties: {
      action: {
        type: "string",
        enum: offers.map((offer) => offer.action),
      },
      fields: {
        type: "object",
        additionalProperties: false,
        required: names,
        properties: Object.fromEntries(
          names.map((name) => [name, nullable(fields[name] ?? [])]),
        ),
      },
      why: { type: "string", maxLength: 1000 },
    },
  };
}

/** The offered actions, their fields and their numbered choices, as text. */
function describeOffers(offers: readonly ProposalOffer[]): string {
  return offers
    .map((offer) => {
      const choices = Object.entries(offer.choices)
        .map(
          ([name, list]) =>
            `  ${name}:\n${list
              .map((choice, index) => `    ${index + 1}. ${choice.label}`)
              .join("\n")}`,
        )
        .join("\n");
      return (
        `action: ${offer.action} (${offer.label})\n` +
        `  what it does: ${offer.whatItDoes}\n` +
        `  fields: ${JSON.stringify(offer.fields)}` +
        (choices === "" ? "" : `\n${choices}`)
      );
    })
    .join("\n\n");
}

/** The tool as the drafter offers it: first round only (A4-D4). */
export function proposeChangeTool(
  offers: readonly ProposalOffer[],
): ReadingTool {
  return {
    name: PROPOSE_TOOL,
    description:
      "Prepare one change for the person to review, when their latest message " +
      "plainly asks for it. Choose a list item by its number. Fill in the " +
      "fields the action takes and set every other field to null. A field " +
      "called reason is the person's own reason: fill it only from their " +
      "words, otherwise null. why is one sentence of your own saying why " +
      "this change answers the request. Never call it for a question.\n\n" +
      `Actions you may propose:\n${describeOffers(offers)}`,
    inputSchema: proposeToolSchema(offers),
    firstRoundOnly: true,
  };
}

/** What a finished call made, for the caller to show and to tell the answer. */
export interface ProposedCard {
  readonly id: string;
  readonly action: string;
  readonly preview: BuiltProposal["preview"];
  readonly why: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * One run's proposer. At most one card (A4-D3): the second call, whenever it
 * comes, gets a sentence and builds nothing.
 */
export function createProposer(
  context: ActionCallContext,
  input: {
    readonly threadId: string;
    readonly offers: readonly ProposalOffer[];
  },
) {
  let made = false;

  /** Never throws: a proposal is the smaller half of the turn. */
  const handle = async (
    args: unknown,
    round: number,
  ): Promise<{
    readonly result: ReadResult;
    readonly card: ProposedCard | null;
  }> => {
    const started = performance.now();
    const done = (
      text: string,
      outcome: ReadResult["outcome"],
      card: ProposedCard | null = null,
    ) => ({
      result: {
        text,
        entities: [],
        outcome,
        durationMs: Math.round(performance.now() - started),
        tool: PROPOSE_TOOL,
      } satisfies ReadResult,
      card,
    });

    // The tool is not in the list after round one. A call that comes anyway
    // is a call to a tool this run does not have (A4-D4, A4-D8).
    if (round > 1) {
      return done(NOT_AVAILABLE_TEXT, "unknown_tool");
    }
    if (made) {
      return done(PROPOSAL_ALREADY_TEXT, "refused");
    }
    const refuse = (reason: ProposalDropReason, action: string | null) => {
      try {
        logProposalDrop({ reason, action }, context.drafter?.identity);
      } catch {
        // A log that fails is not a reason to fail the run.
      }
      return done(refusedText(reason), "refused");
    };

    const given = isObject(args) ? args : {};
    const action = typeof given.action === "string" ? given.action : "";
    const offer = input.offers.find((candidate) => candidate.action === action);
    if (!offer) {
      return refuse("not_offered", action === "" ? null : action);
    }
    const why = typeof given.why === "string" ? given.why.trim() : "";
    if (why === "") {
      // A proposal with no stated reason is one a reviewer cannot judge.
      return refuse("no_reason", action);
    }
    const authoredFields = isObject(given.fields) ? given.fields : {};
    const properties = (offer.fields.properties ?? {}) as Record<
      string,
      unknown
    >;
    const fields = Object.fromEntries(
      Object.entries(authoredFields).filter(
        ([name, value]) =>
          Object.hasOwn(properties, name) && value !== null && value !== "",
      ),
    );
    const required = (offer.fields.required ?? []) as string[];
    if (!required.every((name) => Object.hasOwn(fields, name))) {
      return refuse("fields_refused", action);
    }

    let built: BuiltProposal;
    try {
      built = await buildProposal(
        context,
        { action, fields, why },
        input.offers,
      );
    } catch {
      return refuse("build_refused", action);
    }
    try {
      const recorded = await callAction(context, "copilot.recordProposal", {
        threadId: input.threadId,
        action: built.action,
        payload: built.payload,
        preview: [...built.preview],
        why,
        subjectType: built.subjectType,
        subjectId: built.subjectId,
      });
      made = true;
      return done(PROPOSAL_MADE_TEXT, "ok", {
        id: recorded.id,
        action: built.action,
        preview: built.preview,
        why,
      });
    } catch {
      // Saving failed. That is a fault, not a refusal of what the model wrote,
      // so it is not a drop reason and gets no log line of that kind.
      return done(refusedText("provider_error"), "failed");
    }
  };

  return { handle };
}
