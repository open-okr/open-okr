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
  ClusterableNote,
  DiagnosticContext,
  DraftedCheckIn,
  DraftedKeyResult,
  DraftedObjective,
  FilterContext,
  GroundedAnswer,
  GroundedChunk,
  GroundedQuestionContext,
  ImportMappingContext,
  KpiRequestContext,
  MeasureContext,
  NarratedTrend,
  NoteThemes,
  ParentContext,
  ParsedFilter,
  ProposalRequestContext,
  ProposedAction,
  ProposedImportMapping,
  ProposedObjective,
  RecoveryTitleContext,
  RetrospectiveCheckIn,
  ReviewableGoal,
  SemanticFinding,
  SuggestedKpi,
  SuggestedParent,
  SummarisableBlocker,
  TrendContext,
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
        `[${index + 1}] ${source.label}${NEWLINE}${source.content}`,
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
        : `Passages:${NEWLINE}${passagesFor(context)}`) +
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

/**
 * The rhythm narrations (AI-NATIVE-PLAN.md §2.2, P4-T15b-a).
 *
 * **Neither prompt asks the model to be accurate; the caller checks.** Core
 * compares every number in what comes back against the numbers it computed and
 * drops the narration when one was invented. Telling a model to be careful is
 * not a guarantee, and this is.
 */
const DIGEST_NARRATION_SHAPE = z.object({
  narrative: z.string().trim().max(1200),
});

const DIGEST_NARRATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["narrative"],
  properties: { narrative: { type: "string", maxLength: 1200 } },
} as const;

const TREND_SHAPE = z.object({
  narrative: z.string().trim().max(1200),
  anomalies: z.array(z.string().trim().min(1).max(300)).max(5),
});

const TREND_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["narrative", "anomalies"],
  properties: {
    narrative: { type: "string", maxLength: 1200 },
    anomalies: {
      type: "array",
      maxItems: 5,
      items: { type: "string", maxLength: 300 },
    },
  },
} as const;

const DIGEST_NARRATION_SYSTEM =
  "You rewrite a weekly digest as two or three sentences somebody will read " +
  "in a channel. Say the same things the lines say, in the same order, in " +
  "plainer words. **Use only the numbers that are already in the lines.** " +
  "Never add a figure, a comparison or a percentage that is not there, and " +
  "never round one. Do not congratulate and do not apologise.";

const TREND_SYSTEM =
  "You describe what a metric has done over the periods you are given, and " +
  "you say which movements were unusual for it. **Use only the values you " +
  "are given and the differences between them.** Never state a figure that " +
  "is not in the series, never estimate one, and never describe a period you " +
  "were not shown. An anomaly is a movement that does not fit the pattern, " +
  "not simply the largest one; an empty list is the right answer for a " +
  "series that did what it always does.";

/**
 * The list filter (AI-NATIVE-PLAN.md §2.4, P4-T15d).
 *
 * **`expressible` is a field, so refusing is something the model can say.**
 * §2.4 asks for a filter "refused rather than approximated", and a model given
 * only a filter shape will always fill it in: asked whether the sentence fits
 * the grammar, it answers that question instead of quietly narrowing
 * "blocked on legal" to "off track".
 *
 * The caller re-checks every field against the grammar anyway, so a level or a
 * band the product does not have becomes a refusal rather than a filter.
 */
/**
 * The import column mapping (TECHNICAL-PLAN §7.1 step 2, P6-T01b-a).
 *
 * **One answer per header, in the order the headers were given.** Answering by
 * position rather than by header text means a model that tidies up the spelling
 * of a column cannot map a column that is not in the file. An empty string is a
 * real answer: a spreadsheet exported from another system usually has a column
 * this product has no field for.
 *
 * The caller checks every field against the entity's template, so a field name
 * the model invented is dropped rather than trusted.
 */
const MAPPING_SHAPE = z.object({
  fields: z.array(z.string().trim().max(60)),
  notes: z.string().trim().max(300),
});

const MAPPING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fields", "notes"],
  properties: {
    fields: { type: "array", items: { type: "string" } },
    notes: { type: "string", maxLength: 300 },
  },
} as const;

const MAPPING_SYSTEM =
  "You match the columns of a spreadsheet to the fields of one kind of " +
  "record. Answer with one entry per column, in the order the columns were " +
  "given, using the exact field names you are shown. **Use an empty string " +
  "for a column that is not one of those fields**, which is the right answer " +
  "for a column this record has no place for: a guess that looks right and " +
  "puts a department in a title is worse than leaving it for a person. Never " +
  "use one field for two columns. The notes are one sentence saying what a " +
  "reader should check before confirming.";

const FILTER_SHAPE = z.object({
  expressible: z.boolean(),
  reason: z.string().trim().max(300),
  /** One-based into the cycle list. Zero means the sentence named no cycle. */
  cycle: z.number().int(),
  level: z.string().trim().max(40),
  health: z.string().trim().max(40),
  mine: z.boolean(),
  includeClosed: z.boolean(),
});

const FILTER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "expressible",
    "reason",
    "cycle",
    "level",
    "health",
    "mine",
    "includeClosed",
  ],
  properties: {
    expressible: { type: "boolean" },
    reason: { type: "string", maxLength: 300 },
    cycle: { type: "integer" },
    level: { type: "string" },
    health: { type: "string" },
    mine: { type: "boolean" },
    includeClosed: { type: "boolean" },
  },
} as const;

const FILTER_SYSTEM =
  "You turn a sentence into a filter over a list of objectives. The filter " +
  "can express four things and nothing else: which cycle, which level, which " +
  "health band, and whether the objectives belong to the person asking. " +
  "**If the sentence asks for anything else, say it is not expressible and " +
  "say which part.** Never approximate: a filter that looks right and means " +
  "something else is worse than no filter. Choose a cycle by its number, or " +
  "0 for none. Use the exact level and health words you are given, or an " +
  "empty string for none.";

/**
 * The blocker summary and the KPI suggestion (AI-NATIVE-PLAN.md §2.2,
 * P4-T15b-b).
 *
 * **Neither prompt is trusted to be careful.** The blocker summary is checked
 * against the board it was given, and every field of a suggested KPI is checked
 * against its own enum, corridor bound or, for the formula, §6's own parser.
 */
const BLOCKER_SUMMARY_SHAPE = z.object({
  summary: z.string().trim().max(900),
});

const BLOCKER_SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: { summary: { type: "string", maxLength: 900 } },
} as const;

const BLOCKER_SUMMARY_SYSTEM =
  "You summarise what a team is stuck on, from a list already in priority " +
  "order. Keep that order: the first one is the most urgent because the " +
  "product says so, not because of how it reads. Two or three sentences. " +
  "Quote a next action exactly when you name one, and never name one that is " +
  "not on the list. Say what is aging and who owns it; do not suggest what to " +
  "do about it, because that is the owner's next action and they wrote it.";

const KPI_SHAPE = z.object({
  title: z.string().trim().max(500),
  unit: z.string().trim().max(60).nullable(),
  frequency: z.string().trim().max(40),
  direction: z.string().trim().max(40),
  indicatorType: z.string().trim().max(40),
  targetDefault: z.number().nullable(),
  healthyPct: z.number().nullable(),
  watchPct: z.number().nullable(),
  formulaOperation: z.string().trim().max(20),
  formulaReferences: z.array(z.number().int()).max(8),
  why: z.string().trim().max(500),
});

const KPI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "unit",
    "frequency",
    "direction",
    "indicatorType",
    "targetDefault",
    "healthyPct",
    "watchPct",
    "formulaOperation",
    "formulaReferences",
    "why",
  ],
  properties: {
    title: { type: "string", maxLength: 500 },
    unit: { type: ["string", "null"], maxLength: 60 },
    frequency: { type: "string" },
    direction: { type: "string" },
    indicatorType: { type: "string" },
    targetDefault: { type: ["number", "null"] },
    healthyPct: { type: ["number", "null"] },
    watchPct: { type: ["number", "null"] },
    formulaOperation: { type: "string" },
    formulaReferences: {
      type: "array",
      maxItems: 8,
      items: { type: "integer" },
    },
    why: { type: "string", maxLength: 500 },
  },
} as const;

const KPI_SYSTEM =
  "You turn a description of something somebody wants to measure into one " +
  "metric. Give it a title, a unit, how often it is recorded, whether higher " +
  "or lower is better, and a healthy and a watch percentage of target. Where " +
  "the metric is one number divided by or added to another, name the two " +
  "existing metrics by number and the operator: add, sub, mul or div. Leave " +
  "the operator empty when it is recorded by hand rather than calculated. " +
  "Never reference a metric by anything but its number.";

/**
 * The review assists (AI-NATIVE-PLAN.md §2.3, P4-T15c).
 *
 * **The diagnostic prompt is the careful one.** §8.6's verdict and prescription
 * are the method's, and this is asked for specifics *under* them. It is told
 * not to restate them and not to disagree with them, and the caller returns the
 * method's own sentences whatever comes back, so a model that argues with the
 * verdict changes nothing.
 */
const THEMES_SHAPE = z.object({
  themes: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        noteNumbers: z.array(z.number().int()).max(40),
      }),
    )
    // A retro with twelve themes has no themes. Bounded so the answer stays a
    // lens rather than a re-listing of the board.
    .max(8),
});

const THEMES_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["themes"],
  properties: {
    themes: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "noteNumbers"],
        properties: {
          title: { type: "string", maxLength: 120 },
          noteNumbers: {
            type: "array",
            maxItems: 40,
            items: { type: "integer" },
          },
        },
      },
    },
  },
} as const;

const PROSE_SHAPE = z.object({ text: z.string().trim().max(2000) });

const PROSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string", maxLength: 2000 } },
} as const;

const OBJECTIVES_SHAPE = z.object({
  objectives: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        learningNumber: z.number().int(),
        why: z.string().trim().max(400),
      }),
    )
    .max(6),
});

const OBJECTIVES_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["objectives"],
  properties: {
    objectives: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "learningNumber", "why"],
        properties: {
          title: { type: "string", maxLength: 500 },
          learningNumber: { type: "integer" },
          why: { type: "string", maxLength: 400 },
        },
      },
    },
  },
} as const;

const CLUSTER_SYSTEM =
  "You group a retrospective's notes into a few themes, before the team votes " +
  "on them. A theme is something two or more notes are both about. Refer to " +
  "notes only by their numbers. Leave a note out rather than forcing it into a " +
  "theme it does not belong to: a note on its own is a real answer. Name a " +
  "theme in the team's own words, not in management language.";

const DIAGNOSTIC_SYSTEM =
  "You add the specifics under a verdict that has already been decided. The " +
  "verdict and the prescription are given to you and they are not yours to " +
  "change, restate or argue with: write two or three sentences about what " +
  "actually happened this cycle that the verdict is describing. Use only the " +
  "numbers you are given. Never suggest a different verdict.";

const MINUTES_SYSTEM =
  "You write up a review from its own record: the sections you are given and " +
  "nothing else. Short paragraphs in the order the sections come. Do not add " +
  "a conclusion, do not congratulate anybody, and never mention anything that " +
  "is not in the sections.";

const RETROSPECTIVE_SYSTEM =
  "You write the closing retrospective for an objective, from its own weekly " +
  "check-ins. Say what happened, when it turned, and what somebody would do " +
  "differently. Use only what the check-ins say and the statuses they carry. " +
  "It is a draft the owner will correct, so leave the judgements to them.";

const OBJECTIVES_SYSTEM =
  "You propose objectives for the next cycle, each one answering exactly one " +
  "of the learnings you are given. Cite the learning by its number; a " +
  "proposal that answers no learning is not wanted. An objective says what " +
  "changes, not what gets done. Propose fewer rather than more: a cycle with " +
  "six new objectives from a retrospective is a cycle nobody will finish.";

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
                  ? `${NEWLINE}Team: ${context.spaceName}`
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
                  ? `${NEWLINE}Unit already chosen: ${context.unit}`
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
                  ? `${NEWLINE}  about: ${context.childDescription}`
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

    async narrateDigest(context: {
      readonly lines: readonly string[];
    }): Promise<string | null> {
      if (!affordable() || context.lines.length === 0) {
        return null;
      }
      try {
        const { narrative } = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: DIGEST_NARRATION_SHAPE,
          jsonSchema: DIGEST_NARRATION_JSON_SCHEMA,
          maxTokens: 400,
          onUsage: charge,
          messages: [
            { role: "system", content: DIGEST_NARRATION_SYSTEM },
            {
              role: "user",
              content: `The digest:${NEWLINE}${context.lines.join(NEWLINE)}`,
            },
          ],
        });
        return narrative.trim() === "" ? null : narrative;
      } catch {
        return null;
      }
    },

    async narrateTrend(context: TrendContext): Promise<NarratedTrend | null> {
      if (!affordable() || context.points.length < 2) {
        return null;
      }
      try {
        const narrated = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: TREND_SHAPE,
          jsonSchema: TREND_JSON_SCHEMA,
          maxTokens: 500,
          onUsage: charge,
          messages: [
            { role: "system", content: TREND_SYSTEM },
            {
              role: "user",
              content:
                `Metric: ${context.title}` +
                NEWLINE +
                `Unit: ${context.unit ?? "none given"}` +
                NEWLINE +
                `Better when it goes: ${context.direction}` +
                NEWLINE +
                "Series, oldest first:" +
                NEWLINE +
                context.points
                  .map(
                    (point) =>
                      `  ${point.period}: ${point.value}` +
                      (point.target === null
                        ? ""
                        : ` (target ${point.target})`),
                  )
                  .join(NEWLINE),
            },
          ],
        });
        return narrated.narrative.trim() === "" ? null : narrated;
      } catch {
        return null;
      }
    },

    async parseListFilter(
      context: FilterContext,
    ): Promise<ParsedFilter | null> {
      if (!affordable()) {
        return null;
      }
      try {
        const parsed = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: FILTER_SHAPE,
          jsonSchema: FILTER_JSON_SCHEMA,
          maxTokens: 250,
          onUsage: charge,
          messages: [
            { role: "system", content: FILTER_SYSTEM },
            {
              role: "user",
              content:
                `Sentence: ${context.sentence}` +
                NEWLINE +
                "Cycles:" +
                NEWLINE +
                context.cycles
                  .map((name, index) => `  ${index + 1}. ${name}`)
                  .join(NEWLINE) +
                NEWLINE +
                `Levels: ${context.levels.join(", ")}` +
                NEWLINE +
                `Health bands: ${context.healthBands.join(", ")}`,
            },
          ],
        });

        if (!parsed.expressible) {
          return { kind: "refused", reason: parsed.reason };
        }
        return {
          kind: "filter",
          cycleNumber: parsed.cycle < 1 ? null : parsed.cycle,
          level: parsed.level === "" ? null : parsed.level,
          health: parsed.health === "" ? null : parsed.health,
          mine: parsed.mine,
          includeClosed: parsed.includeClosed,
        };
      } catch {
        return null;
      }
    },

    async proposeImportMapping(
      context: ImportMappingContext,
    ): Promise<ProposedImportMapping | null> {
      if (!affordable() || context.headers.length === 0) {
        return null;
      }
      try {
        const parsed = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: MAPPING_SHAPE,
          jsonSchema: MAPPING_JSON_SCHEMA,
          // Enough for one short field name per column plus the sentence.
          maxTokens: 60 * context.headers.length + 200,
          onUsage: charge,
          messages: [
            { role: "system", content: MAPPING_SYSTEM },
            {
              role: "user",
              content:
                `Records: ${context.entity}. ${context.describe}` +
                NEWLINE +
                "Fields:" +
                NEWLINE +
                context.fields
                  .map(
                    (field) =>
                      `  ${field.field}${field.required ? " (required)" : ""}: ${field.describe}`,
                  )
                  .join(NEWLINE) +
                NEWLINE +
                "Columns, in order:" +
                NEWLINE +
                context.headers
                  .map(
                    (header, index) =>
                      `  ${index + 1}. ${header}${
                        context.sample[index]
                          ? ` (first value: ${context.sample[index]})`
                          : ""
                      }`,
                  )
                  .join(NEWLINE),
            },
          ],
        });

        return { fields: parsed.fields, notes: parsed.notes };
      } catch {
        return null;
      }
    },

    async summariseBlockers(context: {
      readonly blockers: readonly SummarisableBlocker[];
    }): Promise<string | null> {
      if (!affordable() || context.blockers.length === 0) {
        return null;
      }
      try {
        const { summary } = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: BLOCKER_SUMMARY_SHAPE,
          jsonSchema: BLOCKER_SUMMARY_JSON_SCHEMA,
          maxTokens: 400,
          onUsage: charge,
          messages: [
            { role: "system", content: BLOCKER_SUMMARY_SYSTEM },
            {
              role: "user",
              content:
                "Blockers, most urgent first:" +
                NEWLINE +
                context.blockers
                  .map(
                    (blocker, index) =>
                      `  ${index + 1}. [${blocker.type}] "${blocker.nextAction}"` +
                      ` — ${blocker.ownerName ?? "no owner named"},` +
                      ` ${blocker.ageHours}h, escalated to ${blocker.escalation}` +
                      (blocker.blocks ? `, blocks ${blocker.blocks}` : ""),
                  )
                  .join(NEWLINE),
            },
          ],
        });
        return summary.trim() === "" ? null : summary;
      } catch {
        return null;
      }
    },

    async suggestKpi(context: KpiRequestContext): Promise<SuggestedKpi | null> {
      if (!affordable()) {
        return null;
      }
      try {
        const suggested = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: KPI_SHAPE,
          jsonSchema: KPI_JSON_SCHEMA,
          maxTokens: 500,
          onUsage: charge,
          messages: [
            { role: "system", content: KPI_SYSTEM },
            {
              role: "user",
              content:
                `What they want to measure: ${context.description}` +
                (context.existing.length === 0
                  ? `${NEWLINE}There are no existing metrics to combine.`
                  : NEWLINE +
                    "Existing metrics:" +
                    NEWLINE +
                    context.existing
                      .map((title, index) => `  ${index + 1}. ${title}`)
                      .join(NEWLINE)),
            },
          ],
        });
        return {
          title: suggested.title,
          unit: suggested.unit,
          frequency: suggested.frequency,
          direction: suggested.direction,
          indicatorType: suggested.indicatorType,
          targetDefault: suggested.targetDefault,
          healthyPct: suggested.healthyPct,
          watchPct: suggested.watchPct,
          formula:
            suggested.formulaOperation === "" ||
            suggested.formulaReferences.length === 0
              ? null
              : {
                  operation: suggested.formulaOperation,
                  references: suggested.formulaReferences,
                },
          why: suggested.why,
        };
      } catch {
        return null;
      }
    },

    async clusterNotes(context: {
      readonly notes: readonly ClusterableNote[];
    }): Promise<NoteThemes | null> {
      if (!affordable() || context.notes.length < 3) {
        return null;
      }
      try {
        return await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: THEMES_SHAPE,
          jsonSchema: THEMES_JSON_SCHEMA,
          maxTokens: 600,
          onUsage: charge,
          messages: [
            { role: "system", content: CLUSTER_SYSTEM },
            {
              role: "user",
              content:
                "Notes:" +
                NEWLINE +
                context.notes
                  .map(
                    (note, index) =>
                      `  ${index + 1}. [${note.column}] ${note.text}`,
                  )
                  .join(NEWLINE),
            },
          ],
        });
      } catch {
        return null;
      }
    },

    async narrateDiagnostic(
      context: DiagnosticContext,
    ): Promise<string | null> {
      if (!affordable()) {
        return null;
      }
      try {
        const { text } = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: PROSE_SHAPE,
          jsonSchema: PROSE_JSON_SCHEMA,
          maxTokens: 400,
          onUsage: charge,
          messages: [
            { role: "system", content: DIAGNOSTIC_SYSTEM },
            {
              role: "user",
              content:
                `Verdict: ${context.verdict}` +
                NEWLINE +
                `What it means: ${context.diagnosis}` +
                NEWLINE +
                `What to do: ${context.prescription}` +
                NEWLINE +
                `Cycle score: ${context.cycleScore}` +
                NEWLINE +
                `Rhythm score: ${context.rhythmScore}`,
            },
          ],
        });
        return text.trim() === "" ? null : text;
      } catch {
        return null;
      }
    },

    async draftMinutes(context: {
      readonly sections: readonly {
        readonly label: string;
        readonly body: string;
      }[];
    }): Promise<string | null> {
      if (!affordable() || context.sections.length === 0) {
        return null;
      }
      try {
        const { text } = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: PROSE_SHAPE,
          jsonSchema: PROSE_JSON_SCHEMA,
          maxTokens: 900,
          onUsage: charge,
          messages: [
            { role: "system", content: MINUTES_SYSTEM },
            {
              role: "user",
              content: context.sections
                .map((section) => `${section.label}:${NEWLINE}${section.body}`)
                .join(NEWLINE + NEWLINE),
            },
          ],
        });
        return text.trim() === "" ? null : text;
      } catch {
        return null;
      }
    },

    async draftRetrospective(context: {
      readonly goalTitle: string;
      readonly checkIns: readonly RetrospectiveCheckIn[];
    }): Promise<string | null> {
      if (!affordable() || context.checkIns.length === 0) {
        return null;
      }
      try {
        const { text } = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: PROSE_SHAPE,
          jsonSchema: PROSE_JSON_SCHEMA,
          maxTokens: 700,
          onUsage: charge,
          messages: [
            { role: "system", content: RETROSPECTIVE_SYSTEM },
            {
              role: "user",
              content:
                `Objective: ${context.goalTitle}` +
                NEWLINE +
                "Check-ins, oldest first:" +
                NEWLINE +
                context.checkIns
                  .map(
                    (entry) =>
                      `  ${entry.period} [${entry.status}` +
                      (entry.confidence === null
                        ? ""
                        : `, confidence ${entry.confidence}`) +
                      `] ${entry.narrative}`,
                  )
                  .join(NEWLINE),
            },
          ],
        });
        return text.trim() === "" ? null : text;
      } catch {
        return null;
      }
    },

    async proposeObjectives(context: {
      readonly learnings: readonly string[];
    }): Promise<readonly ProposedObjective[] | null> {
      if (!affordable() || context.learnings.length === 0) {
        return null;
      }
      try {
        const { objectives } = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: OBJECTIVES_SHAPE,
          jsonSchema: OBJECTIVES_JSON_SCHEMA,
          maxTokens: 700,
          onUsage: charge,
          messages: [
            { role: "system", content: OBJECTIVES_SYSTEM },
            {
              role: "user",
              content:
                "Learnings carried forward:" +
                NEWLINE +
                context.learnings
                  .map((text, index) => `  ${index + 1}. ${text}`)
                  .join(NEWLINE),
            },
          ],
        });
        return objectives.length === 0 ? null : objectives;
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
            ? `${NEWLINE}    about: ${goal.description}`
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
