/**
 * The drafting capability, implemented against a real provider (P4-T05c-b).
 *
 * `packages/core` declares `AgentDrafter` and never imports a driver;
 * `packages/adapters` holds every driver and knows nothing about the method.
 * This package is the one allowed to depend on both, which is why the
 * implementation lives here and the interface does not.
 *
 * **Every method answers null rather than throwing.** A provider that is off, a
 * budget that is spent, a network that is down, or output the schema refused
 * twice all end the same way: the caller carries on with the deterministic
 * answer. The rhythm is the part that has to work, and a model having a bad
 * minute must not take it down. The one thing that is never done is guessing:
 * `extractStructured` validates with one repair attempt and then fails, and a
 * failure here means no draft rather than an unvalidated one.
 */
import type { AIProvider } from "@openokr/adapters";
import type {
  AgentDrafter,
  AmbitionContext,
  CheckInDraftContext,
  DraftedCheckIn,
  DraftedKeyResult,
  DraftedObjective,
  GroundedAnswer,
  GroundedChunk,
  GroundedQuestionContext,
  MeasureContext,
  ParentContext,
  ProposalRequestContext,
  ProposedAction,
  RecoveryTitleContext,
  ReviewableGoal,
  SemanticFinding,
  SuggestedParent,
} from "@openokr/core";
import { z } from "zod";
import { extractStructured } from "./structured-extraction.ts";

/** What the model is asked for. Narrower than the product's own types on purpose. */
const CHECK_IN_SHAPE = z.object({
  status: z.enum(["on_track", "caution", "off_track"]),
  confidence: z.number().min(0).max(1),
  /** Plain text. The document is assembled here, never by the model. */
  narrative: z.string().trim().min(1).max(2000),
});

const CHECK_IN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "confidence", "narrative"],
  properties: {
    status: { type: "string", enum: ["on_track", "caution", "off_track"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    narrative: { type: "string", maxLength: 2000 },
  },
} as const;

const TITLE_SHAPE = z.object({
  title: z.string().trim().min(1).max(180),
});

const TITLE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: { title: { type: "string", maxLength: 180 } },
} as const;

/**
 * The Champion's own voice, stated once.
 *
 * No threshold, band or check appears here. Those are `packages/method`'s, they
 * are cited by rule key, and a prompt restating one would be a second copy of
 * the canon that nothing verifies.
 */
const CHECK_IN_SYSTEM =
  "You draft a weekly check-in for the person who owns a goal, in their " +
  "voice, for them to correct before publishing. Be specific and short: " +
  "three sentences at most. Say what moved, what did not, and what happens " +
  "next. Never invent a number that was not given to you, never congratulate, " +
  "and never apologise on anybody's behalf.";

const REWRITE_SHAPE = z.object({
  rewritten: z.string().trim().min(1).max(500),
});

const REWRITE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rewritten"],
  properties: { rewritten: { type: "string", maxLength: 500 } },
} as const;

/**
 * The assist is told the rule and asked for one sentence.
 *
 * It is **not** asked to claim it fixed anything: the caller re-runs §4 over
 * whatever comes back and reports what actually passes, so a persuasive rewrite
 * that fixes nothing is caught by the catalogue rather than believed.
 */
const REWRITE_SYSTEM =
  "You rewrite one key result so that it satisfies a named check, changing as " +
  "little as possible and keeping the author's intent. Return one line. Keep " +
  "any number, unit or date that is already there unless the check is about " +
  "that number. Never add a number that was not given to you.";

/**
 * The copilot's voice (AI-NATIVE-PLAN.md §2.4, P4-T14a-b).
 *
 * **Numbered passages, and a numbered answer about which it used.** The model is
 * shown `[1]`, `[2]` and so on, never an identifier, so a source it names can
 * only be one it was given. Core drops a number out of range.
 *
 * The sentinel line is how a *streamed* answer says what it used. A JSON reply
 * would be cleaner and cannot be streamed to a reader: they would watch a string
 * being escaped. So the prose streams and the last line is machine-read and
 * never shown.
 */
const COPILOT_SYSTEM =
  "You answer questions about this workspace's goals, metrics and reviews, " +
  "using only the numbered passages you are given. Be short and specific. If " +
  "the passages do not answer the question, say so plainly and say what is " +
  "missing; never fill a gap with a plausible number, name or date. Refer to a " +
  "passage in your prose by its number in square brackets. End with one final " +
  "line, the word SOURCES then a colon then the numbers you used separated by " +
  "commas, or SOURCES: none. Write nothing after that line.";

/** The line the model ends with, which the reader never sees. */
const SOURCES_SENTINEL = "SOURCES:";

/** How much prose one answer may run to, in tokens. */
const COPILOT_MAX_TOKENS = 700;

/** The passages, numbered from one, as the model is shown them. */
const passagesFor = (context: GroundedQuestionContext): string =>
  context.sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.label}` + NEWLINE + source.content,
    )
    .join(NEWLINE + NEWLINE);

/** The conversation so far, then the passages, then the question. */
const copilotMessages = (context: GroundedQuestionContext) => [
  { role: "system" as const, content: COPILOT_SYSTEM },
  ...context.history.map((turn) => ({
    role: turn.role === "member" ? ("user" as const) : ("assistant" as const),
    content: turn.content,
  })),
  {
    role: "user" as const,
    content:
      (context.sources.length === 0
        ? "There are no passages for this question."
        : "Passages:" + NEWLINE + passagesFor(context)) +
      NEWLINE +
      NEWLINE +
      `Question: ${context.question}`,
  },
];

/**
 * The numbers on the sentinel line, as zero-based indexes.
 *
 * Anything that is not a number is ignored rather than guessed at, and the
 * caller drops an index out of range, so a model writing
 * "SOURCES: 1, the second one" cites the first passage and nothing else.
 */
function parseSources(line: string): number[] {
  const at = line.indexOf(SOURCES_SENTINEL);
  const listed = at < 0 ? line : line.slice(at + SOURCES_SENTINEL.length);
  return listed
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 1)
    .map((value) => value - 1);
}

/** The prose without the sentinel line, and the indexes it named. */
function splitAnswer(raw: string): {
  text: string;
  usedSourceIndexes: number[];
} {
  const at = raw.lastIndexOf(SOURCES_SENTINEL);
  if (at < 0) {
    // A model that forgot the line still answered. No citation is the honest
    // result: it did not say what it used.
    return { text: raw.trim(), usedSourceIndexes: [] };
  }
  return {
    text: raw.slice(0, at).trim(),
    usedSourceIndexes: parseSources(raw.slice(at)),
  };
}

/**
 * A proposal, as a model may express one (P4-T14b-a).
 *
 * **`propose` is a field rather than a nullable object**, because a model asked
 * for "an object or null" returns an object with empty strings in it far more
 * often than it returns null. Asked whether to propose at all, it answers the
 * question. Declining is the common case: most sentences are questions.
 *
 * `fields` is deliberately untyped here. Its shape belongs to the action, and
 * core validates it against that action's own schema before anything is stored,
 * so a second copy of the shape in this file would be a second thing to keep in
 * step.
 */
const PROPOSAL_SHAPE = z.object({
  propose: z.boolean(),
  action: z.string().trim().max(120),
  fields: z.record(z.string(), z.unknown()),
  why: z.string().trim().max(1000),
});

const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["propose", "action", "fields", "why"],
  properties: {
    propose: { type: "boolean" },
    action: { type: "string" },
    fields: { type: "object" },
    why: { type: "string", maxLength: 1000 },
  },
} as const;

const PROPOSAL_SYSTEM =
  "You decide whether what somebody asked for is a request to change " +
  "something in this workspace, and if it is, you fill in one of the actions " +
  "you are offered. Propose nothing unless the request plainly asks for that " +
  "exact change: a question is not a request. Choose a list item by its " +
  "number, never by inventing a name or an identifier. Write only the fields " +
  "the action asks for. Say in one sentence why this change, now.";

/** The offered actions, their fields and their numbered choices, as text. */
const optionsFor = (context: ProposalRequestContext): string =>
  context.options
    .map((option) => {
      const choices = Object.entries(option.choices)
        .map(
          ([name, list]) =>
            `  ${name}:` +
            NEWLINE +
            list
              .map((label, index) => `    ${index + 1}. ${label}`)
              .join(NEWLINE),
        )
        .join(NEWLINE);
      return (
        `action: ${option.action} (${option.label})` +
        NEWLINE +
        `  what it does: ${option.whatItDoes}` +
        NEWLINE +
        `  fields: ${JSON.stringify(option.fields)}` +
        (choices === "" ? "" : NEWLINE + choices)
      );
    })
    .join(NEWLINE + NEWLINE);

/**
 * The drafting assists' shapes (AI-NATIVE-PLAN.md §2.1, P4-T15a).
 *
 * Numbers are required, not optional. A key result without a baseline and a
 * target fails METHOD.md KR-3, and an assist that produced one would be making
 * work rather than saving it. Whether the numbers are any good is not asserted
 * here: core runs §4 over whatever comes back and reports what genuinely passes.
 */
const MEASURE_FIELDS = {
  unit: { type: ["string", "null"], maxLength: 60 },
  direction: {
    type: "string",
    enum: ["increase", "reduce", "maintain", "move"],
  },
  indicatorType: { type: "string", enum: ["leading", "lagging"] },
  baseline: { type: "number" },
  target: { type: "number" },
} as const;

const MEASURE_SHAPE = z.object({
  unit: z.string().trim().max(60).nullable(),
  direction: z.enum(["increase", "reduce", "maintain", "move"]),
  indicatorType: z.enum(["leading", "lagging"]),
  baseline: z.number(),
  target: z.number(),
});

const MEASURE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["unit", "direction", "indicatorType", "baseline", "target"],
  properties: MEASURE_FIELDS,
} as const;

const OBJECTIVE_SHAPE = z.object({
  title: z.string().trim().max(500),
  description: z.string().trim().max(2000),
  keyResults: z
    .array(MEASURE_SHAPE.extend({ title: z.string().trim().min(1).max(500) }))
    // Bounded, because METHOD.md's own guidance is a handful of measures per
    // objective and a model asked for measures will happily write twelve.
    .max(6),
});

const OBJECTIVE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "keyResults"],
  properties: {
    title: { type: "string", maxLength: 500 },
    description: { type: "string", maxLength: 2000 },
    keyResults: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "unit",
          "direction",
          "indicatorType",
          "baseline",
          "target",
        ],
        properties: {
          title: { type: "string", maxLength: 500 },
          ...MEASURE_FIELDS,
        },
      },
    },
  },
} as const;

const PARENT_SHAPE = z.object({
  /** One-based on the wire, because that is how the list is numbered. */
  candidate: z.number().int(),
  reason: z.string().trim().max(400),
});

const PARENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidate", "reason"],
  properties: {
    candidate: { type: "integer" },
    reason: { type: "string", maxLength: 400 },
  },
} as const;

const OBJECTIVE_SYSTEM =
  "You turn an ambition somebody typed into one objective and the measures " +
  "under it. The objective says what changes, not what gets done. Each " +
  "measure carries a baseline and a target as real numbers, and its sentence " +
  "carries them too. Never repeat an objective that already exists. Never " +
  "invent a number you were not given: if you have to choose one, choose a " +
  "round figure the writer will obviously want to correct.";

const MEASURE_SYSTEM =
  "You put numbers on a key result somebody is part way through writing: a " +
  "unit, a direction, a baseline and a target. Keep any number already in " +
  "the sentence. Where you have to choose, choose a round figure the writer " +
  "will obviously want to correct rather than a precise one they will trust.";

const PARENT_SYSTEM =
  "You pick which of the numbered objectives this one should roll up into, " +
  "by number. Pick the one whose success this objective actually contributes " +
  "to, not the one with the most words in common. Answer 0 when none of them " +
  "is a real parent: an objective with no parent is often correct.";

const TITLE_SYSTEM =
  "You name a recovery objective for a metric that has been unhealthy. One " +
  "line, an outcome rather than an activity, no more than twelve words, no " +
  "trailing full stop. Name the metric.";

/**
 * §5.3's four types, positional.
 *
 * `subjectIndex` and `targetIndex` are indices into the list the model was
 * given. It is never shown an identifier, so it cannot name a goal that is not
 * in front of it, and core drops an index out of range.
 */
const REVIEW_SHAPE = z.object({
  findings: z
    .array(
      z.object({
        kind: z.enum(["relink", "dependency", "conflict", "gap"]),
        subjectIndex: z.number().int().min(0),
        targetIndex: z.number().int().min(0).nullable(),
        severity: z.enum(["high", "medium", "low"]),
        reason: z.string().trim().min(1).max(400),
      }),
    )
    // Bounded. A model asked for "everything wrong" with thirty goals will
    // happily produce sixty findings, and a review nobody can read is a review
    // nobody acts on.
    .max(20),
});

const REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "subjectIndex", "targetIndex", "severity", "reason"],
        properties: {
          kind: {
            type: "string",
            enum: ["relink", "dependency", "conflict", "gap"],
          },
          subjectIndex: { type: "integer", minimum: 0 },
          targetIndex: { type: ["integer", "null"], minimum: 0 },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string", maxLength: 400 },
        },
      },
    },
  },
} as const;

/**
 * §5.3's own definitions, given to the model as the definitions rather than
 * paraphrased. The four types are canon; the judgement is what the model adds.
 */
const REVIEW_SYSTEM =
  "You review a set of objectives for problems that structure alone cannot " +
  "show, and return findings of exactly four types. " +
  "relink: this goal's content actually supports a different parent better " +
  "than its current one, or it is unaligned and this is the right parent. " +
  "dependency: these two goals share metrics or workstreams but no explicit " +
  "horizontal link exists. " +
  "conflict: these two goals pull in opposite directions, or double-count " +
  "the same metric. " +
  "gap: something is missing or weak, with no second goal involved. " +
  "Refer to goals by their index in the list. Use targetIndex only for " +
  "relink, dependency and conflict; it is null for gap. Give one specific " +
  "sentence of reasoning that names what you saw, never a general remark. " +
  "Return an empty list when you find nothing: saying nothing is a real " +
  "answer and inventing a finding is not.";

/** Named, because a bare escape inside a template literal is invisible in a diff. */
const NEWLINE = String.fromCharCode(10);

export interface ProviderDrafterOptions {
  readonly provider: AIProvider;
  /** The model this workspace's tier map resolved to. */
  readonly model: string;
  /**
   * Dollars this run may spend, from §4.14's `agentRunCostCapUsd`.
   *
   * Checked before every call rather than after, because a call that has
   * already been made has already been paid for.
   */
  readonly costCapUsd: number;
  /** Dollars per million tokens, for turning usage into spend. */
  readonly costInPerMillion: number;
  readonly costOutPerMillion: number;
}

/** Editor JSON from one paragraph of plain text, which is all a model returns. */
const asDocument = (text: string) => ({
  type: "doc" as const,
  content: [
    {
      type: "paragraph" as const,
      content: [{ type: "text" as const, text }],
    },
  ],
});

export function createProviderDrafter(
  options: ProviderDrafterOptions,
): AgentDrafter {
  let spent = 0;

  /** Whether another call is affordable. Asked before spending, never after. */
  const affordable = () => options.costCapUsd > 0 && spent < options.costCapUsd;

  /**
   * Charged per provider call, which is what `onUsage` reports.
   *
   * Per call rather than per draft, because `extractStructured` may make a
   * second one to repair invalid output and that call is paid for too. The cap
   * therefore catches a model that needs repairing twice as often.
   */
  const charge = (usage?: {
    inputTokens?: number;
    outputTokens?: number;
  }): void => {
    const input = usage?.inputTokens ?? 0;
    const output = usage?.outputTokens ?? 0;
    spent +=
      (input * options.costInPerMillion + output * options.costOutPerMillion) /
      1_000_000;
  };

  return {
    async draftCheckIn(
      context: CheckInDraftContext,
    ): Promise<DraftedCheckIn | null> {
      if (!affordable()) {
        return null;
      }
      const measures = context.keyResults
        .map(
          (kr: { title: string; progressPct: number }) =>
            `- ${kr.title}: ${kr.progressPct}% of the way there`,
        )
        .join("\n");
      try {
        const drafted = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: CHECK_IN_SHAPE,
          jsonSchema: CHECK_IN_JSON_SCHEMA,
          maxTokens: 400,
          onUsage: charge,
          messages: [
            { role: "system", content: CHECK_IN_SYSTEM },
            {
              role: "user",
              content:
                `Goal: ${context.goalTitle}\n` +
                `Days overdue: ${context.daysOverdue}\n` +
                `Last reported status: ${context.previousStatus ?? "never reported"}\n` +
                `Key results:\n${measures || "- none recorded"}`,
            },
          ],
        });
        return {
          status: drafted.status,
          confidence: drafted.confidence,
          narrative: asDocument(drafted.narrative),
        };
      } catch {
        return null;
      }
    },

    async refineRecoveryTitle(
      context: RecoveryTitleContext,
    ): Promise<string | null> {
      if (!affordable()) {
        return null;
      }
      try {
        const { title } = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: TITLE_SHAPE,
          jsonSchema: TITLE_JSON_SCHEMA,
          maxTokens: 80,
          onUsage: charge,
          messages: [
            { role: "system", content: TITLE_SYSTEM },
            {
              role: "user",
              content:
                `Metric: ${context.kpiTitle}\n` +
                `Current achievement: ${context.achievementPct ?? "unknown"}%\n` +
                `The template would say: ${context.templateTitle}`,
            },
          ],
        });
        // **A title identical to the template is not a refinement.** Asked to
        // improve on a sentence, a model will sometimes hand the same sentence
        // back, and returning it would mark the proposal AI-generated for
        // words no model chose. Observed on the first live run against
        // OpenRouter, which returned the template verbatim.
        return title.trim() === context.templateTitle.trim() ? null : title;
      } catch {
        return null;
      }
    },

    async answerGrounded(
      context: GroundedQuestionContext,
    ): Promise<GroundedAnswer | null> {
      if (!affordable()) {
        return null;
      }
      const before = spent;
      try {
        const reply = await options.provider.chat({
          model: options.model,
          messages: copilotMessages(context),
          maxTokens: COPILOT_MAX_TOKENS,
        });
        charge(reply.usage);
        const { text, usedSourceIndexes } = splitAnswer(reply.content);
        if (text === "") {
          return null;
        }
        return {
          text,
          usedSourceIndexes,
          model: options.model,
          tokensIn: reply.usage.inputTokens,
          tokensOut: reply.usage.outputTokens,
          costUsd: spent - before,
        };
      } catch {
        return null;
      }
    },

    /**
     * The same answer, streamed.
     *
     * **A streamed turn records no token count, and that is the port's shape
     * rather than an omission here.** `AIProvider.stream` yields text and no
     * usage, so there is nothing truthful to put in `tokensIn`, `tokensOut` or
     * `costUsd`. Estimating them would put a made-up number in a cost report.
     * The cap is still honoured at the door, so a workspace that has spent its
     * budget cannot start a stream; what it cannot do is stop one part way
     * through on cost. Recorded on the P4-T14a-b row.
     *
     * The sentinel line is held back rather than filtered afterwards: the
     * reader must never watch `SOURCES: 1, 3` appear and then vanish. Anything
     * that could be the beginning of that line stays in the buffer until the
     * next piece proves it is not.
     */
    async *streamGrounded(
      context: GroundedQuestionContext,
      signal?: AbortSignal,
    ): AsyncIterable<GroundedChunk> {
      if (!affordable()) {
        return;
      }
      let buffer = "";
      let sentinel = "";
      // Every word actually sent to the reader, so the `done` chunk carries the
      // same whole answer a non-streamed call would have returned.
      let prose = "";
      const send = (text: string): GroundedChunk => {
        prose += text;
        return { kind: "text", text };
      };
      try {
        for await (const piece of options.provider.stream({
          model: options.model,
          messages: copilotMessages(context),
          maxTokens: COPILOT_MAX_TOKENS,
        })) {
          if (signal?.aborted) {
            // Return rather than throw: what arrived is a real partial answer
            // and the caller records it.
            return;
          }
          if (sentinel !== "") {
            sentinel += piece;
            continue;
          }
          buffer += piece;
          const at = buffer.indexOf(SOURCES_SENTINEL);
          if (at >= 0) {
            const before = buffer.slice(0, at).trimEnd();
            if (before !== "") {
              yield send(before);
            }
            sentinel = buffer.slice(at);
            buffer = "";
            continue;
          }
          // Hold back only what could still turn into the sentinel.
          const safe = buffer.length - (SOURCES_SENTINEL.length - 1);
          if (safe > 0) {
            yield send(buffer.slice(0, safe));
            buffer = buffer.slice(safe);
          }
        }
      } catch {
        // Nothing more is coming. What was yielded already stands, and the
        // caller records it as stopped.
        return;
      }
      if (sentinel === "" && buffer !== "") {
        yield send(buffer);
      }
      yield {
        kind: "done",
        answer: {
          text: prose.trim(),
          usedSourceIndexes: sentinel === "" ? [] : parseSources(sentinel),
          model: options.model,
        },
      };
    },

    async proposeAction(
      context: ProposalRequestContext,
    ): Promise<ProposedAction | null> {
      if (!affordable() || context.options.length === 0) {
        return null;
      }
      try {
        const reply = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: PROPOSAL_SHAPE,
          jsonSchema: PROPOSAL_JSON_SCHEMA,
          maxTokens: 500,
          onUsage: charge,
          messages: [
            { role: "system", content: PROPOSAL_SYSTEM },
            {
              role: "user",
              content:
                `Request: ${context.request}` +
                NEWLINE +
                NEWLINE +
                "Actions you may propose:" +
                NEWLINE +
                optionsFor(context),
            },
          ],
        });
        if (!reply.propose) {
          return null;
        }
        // The action name is checked against the offered list here as well as in
        // core, so a model naming something it was not offered never becomes a
        // call at all.
        const offered = context.options.some(
          (option) => option.action === reply.action,
        );
        if (!offered) {
          return null;
        }
        if (reply.why.trim() === "") {
          // A proposal with no stated reason is a proposal a reviewer cannot
          // judge. Refused rather than shown with a blank line.
          return null;
        }
        return {
          action: reply.action,
          fields: reply.fields,
          why: reply.why,
        };
      } catch {
        return null;
      }
    },

    async draftObjective(
      context: AmbitionContext,
    ): Promise<DraftedObjective | null> {
      if (!affordable()) {
        return null;
      }
      try {
        const drafted = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: OBJECTIVE_SHAPE,
          jsonSchema: OBJECTIVE_JSON_SCHEMA,
          maxTokens: 900,
          onUsage: charge,
          messages: [
            { role: "system", content: OBJECTIVE_SYSTEM },
            {
              role: "user",
              content:
                `Ambition: ${context.ambition}` +
                (context.spaceName
                  ? NEWLINE + `Team: ${context.spaceName}`
                  : "") +
                (context.existingTitles.length === 0
                  ? ""
                  : NEWLINE +
                    "Objectives this cycle already has:" +
                    NEWLINE +
                    context.existingTitles
                      .map((title) => `- ${title}`)
                      .join(NEWLINE)),
            },
          ],
        });
        return drafted.title.trim() === "" ? null : drafted;
      } catch {
        return null;
      }
    },

    async suggestMeasure(
      context: MeasureContext,
    ): Promise<Omit<DraftedKeyResult, "title"> | null> {
      if (!affordable()) {
        return null;
      }
      try {
        return await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: MEASURE_SHAPE,
          jsonSchema: MEASURE_JSON_SCHEMA,
          maxTokens: 250,
          onUsage: charge,
          messages: [
            { role: "system", content: MEASURE_SYSTEM },
            {
              role: "user",
              content:
                `Objective: ${context.goalTitle}` +
                NEWLINE +
                `Key result so far: ${context.keyResultTitle}` +
                (context.unit
                  ? NEWLINE + `Unit already chosen: ${context.unit}`
                  : ""),
            },
          ],
        });
      } catch {
        return null;
      }
    },

    /**
     * The parent, by number.
     *
     * Zero means none, and it is offered deliberately: a model given a list and
     * no way to decline picks something. `candidateIndex` comes back zero-based
     * because that is what core indexes with, and the wire is one-based because
     * that is how the list is numbered in the prompt.
     */
    async suggestParent(
      context: ParentContext,
    ): Promise<SuggestedParent | null> {
      if (!affordable() || context.candidates.length === 0) {
        return null;
      }
      try {
        const picked = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: PARENT_SHAPE,
          jsonSchema: PARENT_JSON_SCHEMA,
          maxTokens: 250,
          onUsage: charge,
          messages: [
            { role: "system", content: PARENT_SYSTEM },
            {
              role: "user",
              content:
                `This objective: ${context.childTitle}` +
                (context.childDescription
                  ? NEWLINE + `  about: ${context.childDescription}`
                  : "") +
                NEWLINE +
                "Possible parents:" +
                NEWLINE +
                context.candidates
                  .map(
                    (candidate, index) =>
                      `${index + 1}. [${candidate.level}] ${candidate.title}`,
                  )
                  .join(NEWLINE),
            },
          ],
        });
        if (picked.candidate < 1 || picked.reason.trim() === "") {
          return null;
        }
        return {
          candidateIndex: picked.candidate - 1,
          reason: picked.reason,
        };
      } catch {
        return null;
      }
    },

    async rewriteForRule(context) {
      if (!affordable()) {
        return null;
      }
      try {
        const { rewritten } = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: REWRITE_SHAPE,
          jsonSchema: REWRITE_JSON_SCHEMA,
          maxTokens: 200,
          onUsage: charge,
          messages: [
            { role: "system", content: REWRITE_SYSTEM },
            {
              role: "user",
              content:
                `Objective: ${context.goalTitle}` +
                NEWLINE +
                `Key result as written: ${context.text}` +
                NEWLINE +
                `Failing check ${context.ruleId}: ${context.rulePrompt}`,
            },
          ],
        });
        return rewritten;
      } catch {
        return null;
      }
    },

    async reviewAlignment(
      goals: readonly ReviewableGoal[],
    ): Promise<readonly SemanticFinding[] | null> {
      if (!affordable()) {
        return null;
      }
      const listing = goals
        .map((goal, index) => {
          const parent =
            goal.parentIndex === null
              ? "none in this set"
              : `#${goal.parentIndex}`;
          const measures =
            goal.keyResultTitles.length === 0
              ? "none"
              : goal.keyResultTitles.join("; ");
          const where = goal.spaceName ? `, ${goal.spaceName}` : "";
          const about = goal.description
            ? NEWLINE + `    about: ${goal.description}`
            : "";
          return (
            `#${index} [${goal.level}${where}] ${goal.title}` +
            NEWLINE +
            `    parent: ${parent}` +
            NEWLINE +
            `    key results: ${measures}` +
            about
          );
        })
        .join(NEWLINE);

      try {
        const { findings } = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: REVIEW_SHAPE,
          jsonSchema: REVIEW_JSON_SCHEMA,
          maxTokens: 1500,
          onUsage: charge,
          messages: [
            { role: "system", content: REVIEW_SYSTEM },
            { role: "user", content: listing },
          ],
        });
        return findings;
      } catch {
        return null;
      }
    },

    spentUsd: () => spent,
  };
}
