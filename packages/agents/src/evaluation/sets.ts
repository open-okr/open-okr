/**
 * The evaluation sets: one per drafter capability (plan 0.7.0 A9,
 * docs/design/ai-evaluation.md §5).
 *
 * **Pass bar, decision A4: every fixture in a set passes against the mock.**
 * A set passes whole or the gate refuses.
 *
 * Each fixture is a request the product really makes, in Northwind's words,
 * and the reply a well-behaved model would give, or one the product must turn
 * down. The expected value is what the capability hands its caller after its
 * own checks, so a fixture fails when the product would treat the reply
 * differently, not when a model would word it differently.
 *
 * No fixture holds an email address or a phone number, so a `personal-data`
 * failure is always about the prompt under test. A check's own words come
 * from `packages/method`, never from here, for the reason every coaching line
 * does.
 */
import {
  type AgentDrafter,
  type AmbitionContext,
  type CheckInDraftContext,
  type ClusterableNote,
  type DecompositionContext,
  type DiagnosticContext,
  type FilterContext,
  type GroundedAnswer,
  type GroundedQuestionContext,
  type ImportMappingContext,
  type KpiRequestContext,
  type MeasureContext,
  type ParentContext,
  type PlanRunContext,
  PROMPT_KEYS,
  type PromptKey,
  type ProposalRequestContext,
  type RecoveryTitleContext,
  type RetrospectiveCheckIn,
  type ReviewableGoal,
  type RewriteContext,
  type SummarisableBlocker,
  type ThreadComment,
  type TrendContext,
} from "@openokr/core";
import { diagnosisFor, KEY_RESULT_CHECKS } from "@openokr/method";
import {
  DEFAULT_INPUT_BUDGET_TOKENS,
  type EvaluationSet,
  missingAs,
} from "./run.ts";

/** A capability the drafter offers. */
type Capability = Exclude<keyof AgentDrafter, "spentUsd" | "identity">;

interface FixtureSpec<C> {
  readonly name: string;
  readonly context: C;
  readonly reply: string | readonly string[];
  readonly expected: unknown;
}

/** One set, typed by what its capability is given. */
function evaluationSet<C>(spec: {
  readonly capability: Capability;
  readonly promptKey?: PromptKey;
  readonly inputBudgetTokens?: number;
  readonly call: (
    drafter: AgentDrafter,
    context: C,
    note: (text: string) => void,
  ) => Promise<unknown> | undefined;
  readonly fixtures: readonly FixtureSpec<C>[];
}): EvaluationSet {
  return {
    capability: spec.capability,
    promptKey: spec.promptKey ?? null,
    inputBudgetTokens: spec.inputBudgetTokens ?? DEFAULT_INPUT_BUDGET_TOKENS,
    fixtures: spec.fixtures.map((fixture) => ({
      name: fixture.name,
      reply: fixture.reply,
      expected: fixture.expected,
      run: (drafter, note) =>
        missingAs(spec.call(drafter, fixture.context, note)),
    })),
  };
}

const json = (value: unknown): string => JSON.stringify(value);

/** A reply no schema accepts, so the one repair attempt fails too. */
const UNREADABLE = "Here is your draft, as requested.";

/** What a mock run's grounded answer carries beside the words. */
const MOCK_ANSWER = {
  model: "evaluation",
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
} as const;

// ---------------------------------------------------------------------------
// §2.1 planning and drafting

const AMBITION: AmbitionContext = {
  ambition: "Mid-market customers should get value in their first week",
  spaceName: "Customer Success",
  existingTitles: ["Win the mid-market", "Cut time to first report"],
};

const DRAFTED_OBJECTIVE = {
  title: "Mid-market customers see value in their first week",
  description: "Activation is the gap between a signed contract and a renewal.",
  keyResults: [
    {
      title: "Raise week-one activation from 41% to 60%",
      unit: "%",
      direction: "increase",
      indicatorType: "lagging",
      baseline: 41,
      target: 60,
    },
    {
      title: "Hold a day-two call with 90% of new accounts, up from 20%",
      unit: "%",
      direction: "increase",
      indicatorType: "leading",
      baseline: 20,
      target: 90,
    },
  ],
};

const draftObjective = evaluationSet<AmbitionContext>({
  capability: "draftObjective",
  promptKey: PROMPT_KEYS.draftObjective,
  call: (drafter, context) => drafter.draftObjective?.(context),
  fixtures: [
    {
      name: "an ambition with a team and two objectives already",
      context: AMBITION,
      reply: json(DRAFTED_OBJECTIVE),
      expected: DRAFTED_OBJECTIVE,
    },
    {
      name: "an ambition at workspace level with nothing yet",
      context: { ...AMBITION, spaceName: null, existingTitles: [] },
      reply: json({ ...DRAFTED_OBJECTIVE, keyResults: [] }),
      expected: { ...DRAFTED_OBJECTIVE, keyResults: [] },
    },
    {
      name: "a reply with no title is no draft",
      context: AMBITION,
      reply: json({ title: " ", description: "", keyResults: [] }),
      expected: null,
    },
    {
      name: "a reply the schema refuses twice",
      context: AMBITION,
      reply: UNREADABLE,
      expected: null,
    },
  ],
});

/** A real check and its own prompt, because the method is the only source. */
const FAILING_CHECK = KEY_RESULT_CHECKS[1];
const REWRITE: RewriteContext = {
  text: "Improve customer onboarding",
  ruleId: FAILING_CHECK?.id ?? "",
  rulePrompt:
    FAILING_CHECK?.conditions.find((row) => row.status !== "pass")?.prompt ??
    "",
  goalTitle: "Win the mid-market",
};

const rewriteForRule = evaluationSet<RewriteContext>({
  capability: "rewriteForRule",
  promptKey: PROMPT_KEYS.rewriteForRule,
  call: (drafter, context) => drafter.rewriteForRule?.(context),
  fixtures: [
    {
      name: "a key result with no numbers",
      context: REWRITE,
      reply: json({ rewritten: "Cut onboarding from four days to two" }),
      expected: "Cut onboarding from four days to two",
    },
    {
      name: "a reply with nothing in it",
      context: REWRITE,
      reply: json({ rewritten: "" }),
      expected: null,
    },
    {
      name: "a reply the schema refuses twice",
      context: REWRITE,
      reply: UNREADABLE,
      expected: null,
    },
  ],
});

const MEASURE: MeasureContext = {
  goalTitle: "Win the mid-market",
  keyResultTitle: "Raise trial to paid conversion",
  unit: null,
};

const MEASURED = {
  unit: "%",
  direction: "increase",
  indicatorType: "lagging",
  baseline: 18,
  target: 30,
};

const suggestMeasure = evaluationSet<MeasureContext>({
  capability: "suggestMeasure",
  call: (drafter, context) => drafter.suggestMeasure?.(context),
  fixtures: [
    {
      name: "a key result part way written",
      context: MEASURE,
      reply: json(MEASURED),
      expected: MEASURED,
    },
    {
      name: "a direction the product does not have",
      context: { ...MEASURE, unit: "%" },
      reply: json({ ...MEASURED, direction: "sideways" }),
      expected: null,
    },
  ],
});

const PARENT: ParentContext = {
  childTitle: "Raise mid-market activation",
  childDescription: "New accounts reach value in their first week.",
  candidates: [
    { title: "Win the mid-market", level: "company" },
    { title: "Keep enterprise churn under 3%", level: "company" },
  ],
};

const suggestParent = evaluationSet<ParentContext>({
  capability: "suggestParent",
  call: (drafter, context) => drafter.suggestParent?.(context),
  fixtures: [
    {
      name: "a parent picked by number",
      context: PARENT,
      reply: json({
        candidate: 1,
        reason: "Activation is how the mid-market is won.",
      }),
      expected: {
        candidateIndex: 0,
        reason: "Activation is how the mid-market is won.",
      },
    },
    {
      name: "none of them is a parent",
      context: PARENT,
      reply: json({ candidate: 0, reason: "Neither is what this serves." }),
      expected: null,
    },
    {
      name: "a pick with no reason",
      context: PARENT,
      reply: json({ candidate: 2, reason: "" }),
      expected: null,
    },
  ],
});

// ---------------------------------------------------------------------------
// §2.2 running the rhythm

const CHECK_IN: CheckInDraftContext = {
  goalTitle: "Raise mid-market activation",
  daysOverdue: 3,
  previousStatus: "on_track",
  keyResults: [
    { title: "Close 12 mid-market logos", progressPct: 42 },
    { title: "Raise activation from 41% to 60%", progressPct: 30 },
  ],
};

const CHECK_IN_WORDS =
  "Two logos closed this week. Activation is flat. Next week support starts the day-two call.";

const draftCheckIn = evaluationSet<CheckInDraftContext>({
  capability: "draftCheckIn",
  call: (drafter, context) => drafter.draftCheckIn?.(context),
  fixtures: [
    {
      name: "a check-in three days overdue",
      context: CHECK_IN,
      reply: json({
        status: "caution",
        confidence: 0.6,
        narrative: CHECK_IN_WORDS,
      }),
      expected: {
        status: "caution",
        confidence: 0.6,
        narrative: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: CHECK_IN_WORDS }],
            },
          ],
        },
      },
    },
    {
      name: "a confidence off the scale",
      context: { ...CHECK_IN, previousStatus: null },
      reply: json({
        status: "on_track",
        confidence: 1.5,
        narrative: CHECK_IN_WORDS,
      }),
      expected: null,
    },
  ],
});

const RECOVERY: RecoveryTitleContext = {
  kpiTitle: "Net revenue retention",
  templateTitle: "Recover Net revenue retention",
  achievementPct: 82,
};

const refineRecoveryTitle = evaluationSet<RecoveryTitleContext>({
  capability: "refineRecoveryTitle",
  call: (drafter, context) => drafter.refineRecoveryTitle?.(context),
  fixtures: [
    {
      name: "a metric below its corridor",
      context: RECOVERY,
      reply: json({ title: "Customers who stay keep growing their spend" }),
      expected: "Customers who stay keep growing their spend",
    },
    {
      name: "a title that only repeats the template",
      context: { ...RECOVERY, achievementPct: null },
      reply: json({ title: "Recover Net revenue retention" }),
      expected: null,
    },
  ],
});

const DIGEST = {
  lines: [
    "3 of 5 objectives on track",
    "2 check-ins overdue",
    "1 blocker past its next action",
  ],
};

const narrateDigest = evaluationSet<{ readonly lines: readonly string[] }>({
  capability: "narrateDigest",
  call: (drafter, context) => drafter.narrateDigest?.(context),
  fixtures: [
    {
      name: "a week with something overdue",
      context: DIGEST,
      reply: json({
        narrative:
          "Three of five objectives are on track. Two check-ins are overdue, and one blocker is past its next action.",
      }),
      expected:
        "Three of five objectives are on track. Two check-ins are overdue, and one blocker is past its next action.",
    },
    {
      name: "a narration with nothing in it",
      context: DIGEST,
      reply: json({ narrative: "" }),
      expected: null,
    },
  ],
});

const TREND: TrendContext = {
  title: "Net revenue retention",
  unit: "%",
  direction: "increase",
  points: [
    { period: "January", value: 104, target: 110 },
    { period: "February", value: 101, target: 110 },
    { period: "March", value: 97, target: 110 },
  ],
};

const NARRATED_TREND = {
  narrative: "Retention fell from 104% to 97% over three months.",
  anomalies: ["March fell 4 points, the largest drop in the series."],
};

const narrateTrend = evaluationSet<TrendContext>({
  capability: "narrateTrend",
  call: (drafter, context) => drafter.narrateTrend?.(context),
  fixtures: [
    {
      name: "three months falling",
      context: TREND,
      reply: json(NARRATED_TREND),
      expected: NARRATED_TREND,
    },
    {
      name: "a narration with nothing in it",
      context: TREND,
      reply: json({ narrative: "", anomalies: [] }),
      expected: null,
    },
  ],
});

const BLOCKERS: { readonly blockers: readonly SummarisableBlocker[] } = {
  blockers: [
    {
      type: "dependency",
      nextAction: "Finance names the billing owner",
      ownerName: "Sam",
      ageHours: 52,
      blocks: "Trial handover",
      escalation: "manager",
    },
    {
      type: "capacity",
      nextAction: "Hire a second onboarding lead",
      ownerName: null,
      ageHours: 20,
      blocks: null,
      escalation: "owner",
    },
  ],
};

const summariseBlockers = evaluationSet<typeof BLOCKERS>({
  capability: "summariseBlockers",
  call: (drafter, context) => drafter.summariseBlockers?.(context),
  fixtures: [
    {
      name: "two blockers, one aging",
      context: BLOCKERS,
      reply: json({
        summary:
          "The trial handover waits on finance naming the billing owner, two days old and with Sam's manager.",
      }),
      expected:
        "The trial handover waits on finance naming the billing owner, two days old and with Sam's manager.",
    },
    {
      name: "a summary with nothing in it",
      context: BLOCKERS,
      reply: json({ summary: "" }),
      expected: null,
    },
  ],
});

const KPI: KpiRequestContext = {
  description: "How many trials become paying customers",
  existing: ["Trials started", "Paid conversions"],
};

const SUGGESTED_KPI_REPLY = {
  title: "Trial to paid conversion",
  unit: "%",
  frequency: "monthly",
  direction: "higher_better",
  indicatorType: "lagging",
  targetDefault: 30,
  healthyPct: 90,
  watchPct: 75,
  formulaOperation: "div",
  formulaReferences: [2, 1],
  why: "Paid conversions over trials started is the share that pays.",
};

/** The reply without its formula fields, which the drafter folds into one. */
const SUGGESTED_KPI = {
  title: SUGGESTED_KPI_REPLY.title,
  unit: SUGGESTED_KPI_REPLY.unit,
  frequency: SUGGESTED_KPI_REPLY.frequency,
  direction: SUGGESTED_KPI_REPLY.direction,
  indicatorType: SUGGESTED_KPI_REPLY.indicatorType,
  targetDefault: SUGGESTED_KPI_REPLY.targetDefault,
  healthyPct: SUGGESTED_KPI_REPLY.healthyPct,
  watchPct: SUGGESTED_KPI_REPLY.watchPct,
  why: SUGGESTED_KPI_REPLY.why,
};

const suggestKpi = evaluationSet<KpiRequestContext>({
  capability: "suggestKpi",
  call: (drafter, context) => drafter.suggestKpi?.(context),
  fixtures: [
    {
      name: "a ratio of two metrics already recorded",
      context: KPI,
      reply: json(SUGGESTED_KPI_REPLY),
      expected: {
        ...SUGGESTED_KPI,
        formula: { operation: "div", references: [2, 1] },
      },
    },
    {
      name: "a metric recorded by hand",
      context: { ...KPI, existing: [] },
      reply: json({
        ...SUGGESTED_KPI_REPLY,
        formulaOperation: "",
        formulaReferences: [],
      }),
      expected: { ...SUGGESTED_KPI, formula: null },
    },
    {
      name: "a reply the schema refuses twice",
      context: KPI,
      reply: UNREADABLE,
      expected: null,
    },
  ],
});

// ---------------------------------------------------------------------------
// A custom agent's planning step (plan 0.7.0 A7)

const PLAN_CONTEXT: PlanRunContext = {
  agentName: "Onboarding helper",
  stage: "execution",
  instructions:
    "Each week, look for key results with low confidence and propose a check-in note asking the owner what changed.",
  resources: [
    {
      kind: "goal",
      id: "01a1c0af-0000-7000-8000-000000000001",
      title: "Make onboarding self-serve",
      level: "team",
      state: "at_risk",
      progressPct: 35,
      confidence: null,
      goalId: null,
    },
    {
      kind: "key_result",
      id: "01a1c0af-0000-7000-8000-000000000002",
      title: "Raise self-serve activation from 20% to 45%",
      level: null,
      state: null,
      progressPct: 30,
      confidence: 0.3,
      goalId: "01a1c0af-0000-7000-8000-000000000001",
    },
  ],
  menu: [
    { name: "goals.read", summary: "Reads one goal." },
    { name: "comments.create", summary: "Adds a comment to a subject." },
  ],
};

const PLANNED_TASK = {
  action: "comments.create",
  inputJson: json({
    subjectType: "goal",
    subjectId: "01a1c0af-0000-7000-8000-000000000001",
  }),
  subjectType: "goal",
  subjectId: "01a1c0af-0000-7000-8000-000000000001",
  why: "Confidence on activation is 0.3; ask the owner what changed.",
};

const planRun = evaluationSet<PlanRunContext>({
  capability: "planRun",
  call: (drafter, context) => drafter.planRun?.(context),
  fixtures: [
    {
      name: "one task from the menu about a goal it can see",
      context: PLAN_CONTEXT,
      reply: json({ tasks: [PLANNED_TASK] }),
      expected: {
        tasks: [
          {
            action: "comments.create",
            input: {
              subjectType: "goal",
              subjectId: "01a1c0af-0000-7000-8000-000000000001",
            },
            subjectType: "goal",
            subjectId: "01a1c0af-0000-7000-8000-000000000001",
            why: PLANNED_TASK.why,
          },
        ],
      },
    },
    {
      name: "nothing worth doing, so no tasks",
      context: { ...PLAN_CONTEXT, resources: [] },
      reply: json({ tasks: [] }),
      expected: { tasks: [] },
    },
    {
      name: "a reply the schema refuses twice",
      context: PLAN_CONTEXT,
      reply: UNREADABLE,
      expected: null,
    },
  ],
});

// ---------------------------------------------------------------------------
// §2.3 reviewing and learning

const NOTES: { readonly notes: readonly ClusterableNote[] } = {
  notes: [
    { text: "The day-two call helped new accounts", column: "worked" },
    { text: "Support owned the call well", column: "worked" },
    { text: "Billing blocked two handovers", column: "did not work" },
  ],
};

const THEMES = {
  themes: [{ title: "The day-two call", noteNumbers: [1, 2] }],
};

const clusterNotes = evaluationSet<typeof NOTES>({
  capability: "clusterNotes",
  call: (drafter, context) => drafter.clusterNotes?.(context),
  fixtures: [
    {
      name: "two notes about one thing and one alone",
      context: NOTES,
      reply: json(THEMES),
      expected: THEMES,
    },
    {
      name: "a reply the schema refuses twice",
      context: NOTES,
      reply: UNREADABLE,
      expected: null,
    },
  ],
});

/** §8.6's own sentences, from the package, never restated here. */
const VERDICT = diagnosisFor("strategy_or_quality");
const DIAGNOSTIC: DiagnosticContext = {
  verdict: VERDICT.kind,
  diagnosis: VERDICT.diagnosis,
  prescription: VERDICT.prescription,
  cycleScore: 0.42,
  rhythmScore: 0.85,
};

const narrateDiagnostic = evaluationSet<DiagnosticContext>({
  capability: "narrateDiagnostic",
  call: (drafter, context) => drafter.narrateDiagnostic?.(context),
  fixtures: [
    {
      name: "a cycle that kept the rhythm and still missed",
      context: DIAGNOSTIC,
      reply: json({
        text: "The team checked in nearly every week and still closed the cycle at 0.42.",
      }),
      expected:
        "The team checked in nearly every week and still closed the cycle at 0.42.",
    },
    {
      name: "a narrative with nothing in it",
      context: DIAGNOSTIC,
      reply: json({ text: "" }),
      expected: null,
    },
  ],
});

const MINUTES = {
  sections: [
    { label: "Wins", body: "Two mid-market logos closed." },
    { label: "Shifts", body: "Support owns the day-two call for six weeks." },
  ],
};

const draftMinutes = evaluationSet<typeof MINUTES>({
  capability: "draftMinutes",
  call: (drafter, context) => drafter.draftMinutes?.(context),
  fixtures: [
    {
      name: "a review with wins and a shift",
      context: MINUTES,
      reply: json({
        text: "Two mid-market logos closed. Support owns the day-two call for the next six weeks.",
      }),
      expected:
        "Two mid-market logos closed. Support owns the day-two call for the next six weeks.",
    },
    {
      name: "minutes with nothing in them",
      context: MINUTES,
      reply: json({ text: "" }),
      expected: null,
    },
  ],
});

const RETROSPECTIVE: {
  readonly goalTitle: string;
  readonly checkIns: readonly RetrospectiveCheckIn[];
} = {
  goalTitle: "Raise mid-market activation",
  checkIns: [
    {
      period: "Week 1",
      status: "on_track",
      confidence: 0.7,
      narrative: "Started the day-two call.",
    },
    {
      period: "Week 6",
      status: "caution",
      confidence: 0.5,
      narrative: "Billing blocked two handovers.",
    },
  ],
};

const draftRetrospective = evaluationSet<typeof RETROSPECTIVE>({
  capability: "draftRetrospective",
  call: (drafter, context) => drafter.draftRetrospective?.(context),
  fixtures: [
    {
      name: "a quarter that turned in week six",
      context: RETROSPECTIVE,
      reply: json({
        text: "The day-two call started well. In week six billing blocked two handovers and confidence fell.",
      }),
      expected:
        "The day-two call started well. In week six billing blocked two handovers and confidence fell.",
    },
    {
      name: "a retrospective with nothing in it",
      context: RETROSPECTIVE,
      reply: json({ text: "" }),
      expected: null,
    },
  ],
});

const LEARNINGS = {
  learnings: [
    "Activation stalls on the second day",
    "Billing blocks trial handovers",
  ],
};

const PROPOSED = [
  {
    title: "New accounts reach value on their second day",
    learningNumber: 1,
    why: "It answers the stall on day two.",
  },
];

const proposeObjectives = evaluationSet<typeof LEARNINGS>({
  capability: "proposeObjectives",
  call: (drafter, context) => drafter.proposeObjectives?.(context),
  fixtures: [
    {
      name: "two learnings carried forward",
      context: LEARNINGS,
      reply: json({ objectives: PROPOSED }),
      expected: PROPOSED,
    },
    {
      name: "no proposal at all",
      context: LEARNINGS,
      reply: json({ objectives: [] }),
      expected: null,
    },
  ],
});

// ---------------------------------------------------------------------------
// §2.4 working across the product

const THREAD: {
  readonly subject: string;
  readonly comments: readonly ThreadComment[];
} = {
  subject: "goal",
  comments: [
    { author: "Priya", text: "Billing keeps blocking the trial handover." },
    { author: "Sam", text: "Can finance own it by Friday?" },
    { author: "Priya", text: "The pricing page change did nothing." },
  ],
};

const SUMMARY = {
  summary:
    "Billing blocks the trial handover, and the pricing change did not help.",
  openQuestions: ["Can finance own it by Friday?"],
};

const summariseThread = evaluationSet<typeof THREAD>({
  capability: "summariseThread",
  call: (drafter, context) => drafter.summariseThread?.(context),
  fixtures: [
    {
      name: "a thread with one question left open",
      context: THREAD,
      reply: json(SUMMARY),
      expected: SUMMARY,
    },
    {
      name: "a reply the schema refuses twice",
      context: THREAD,
      reply: UNREADABLE,
      expected: null,
    },
  ],
});

const KEY_RESULT: DecompositionContext = {
  goalTitle: "Raise mid-market activation",
  keyResultTitle: "Trial to paid conversion from 18% to 30%",
  unit: "%",
  direction: "increase",
  baseline: 18,
  target: 30,
  current: 21,
  existingInitiatives: ["Rebuild the trial checklist"],
};

const INITIATIVES = [
  {
    title: "A day-two call for every trial",
    description: "Support calls each new trial on its second day.",
    tasks: ["Write the call script", "Book the first ten calls"],
  },
];

const decomposeKeyResult = evaluationSet<DecompositionContext>({
  capability: "decomposeKeyResult",
  call: (drafter, context) => drafter.decomposeKeyResult?.(context),
  fixtures: [
    {
      name: "a key result part way to target",
      context: KEY_RESULT,
      reply: json({ initiatives: INITIATIVES }),
      expected: INITIATIVES,
    },
    {
      name: "a key result with no target yet",
      context: { ...KEY_RESULT, target: null, existingInitiatives: [] },
      reply: json({ initiatives: [] }),
      expected: null,
    },
  ],
});

const FILTER: FilterContext = {
  sentence: "my objectives that are off track this quarter",
  cycles: ["Q1 2027", "Q2 2027"],
  levels: ["company", "department", "team", "individual"],
  healthBands: ["pending", "on_track", "caution", "off_track"],
};

const parseListFilter = evaluationSet<FilterContext>({
  capability: "parseListFilter",
  call: (drafter, context) => drafter.parseListFilter?.(context),
  fixtures: [
    {
      name: "a sentence the filter can say",
      context: FILTER,
      reply: json({
        expressible: true,
        reason: "",
        cycle: 1,
        level: "",
        health: "off_track",
        mine: true,
        includeClosed: false,
      }),
      expected: {
        kind: "filter",
        cycleNumber: 1,
        level: null,
        health: "off_track",
        mine: true,
        includeClosed: false,
      },
    },
    {
      name: "a sentence the filter cannot say",
      context: { ...FILTER, sentence: "objectives blocked on legal" },
      reply: json({
        expressible: false,
        reason: "The filter cannot say what something is blocked on.",
        cycle: 0,
        level: "",
        health: "",
        mine: false,
        includeClosed: false,
      }),
      expected: {
        kind: "refused",
        reason: "The filter cannot say what something is blocked on.",
      },
    },
    {
      name: "a reply the schema refuses twice",
      context: FILTER,
      reply: UNREADABLE,
      expected: null,
    },
  ],
});

const IMPORT_MAPPING: ImportMappingContext = {
  entity: "objectives",
  describe: "One row per objective.",
  headers: ["Objective", "Owner", "Department"],
  fields: [
    { field: "title", describe: "The objective", required: true },
    { field: "owner", describe: "Who owns it", required: false },
  ],
  sample: ["Win the mid-market", "Priya", "Sales"],
};

const MAPPING = {
  fields: ["title", "owner", ""],
  notes: "Check that Owner holds names this workspace knows.",
};

const proposeImportMapping = evaluationSet<ImportMappingContext>({
  capability: "proposeImportMapping",
  call: (drafter, context) => drafter.proposeImportMapping?.(context),
  fixtures: [
    {
      name: "three columns, one with no field",
      context: IMPORT_MAPPING,
      reply: json(MAPPING),
      expected: MAPPING,
    },
    {
      name: "a reply the schema refuses twice",
      context: IMPORT_MAPPING,
      reply: UNREADABLE,
      expected: null,
    },
  ],
});

/**
 * The copilot's proposal: the one place a model selects a tool (design §4).
 * The offered action is the tool; a pick off the list is no pick.
 */
const PROPOSAL: ProposalRequestContext = {
  request: "Add a key result to raise activation to 60%",
  options: [
    {
      action: "goals.addKeyResult",
      label: "Add a key result",
      whatItDoes: "Adds a key result to an objective you may edit.",
      // Required, as every action core offers says, so a live reply that
      // leaves them empty is no answer rather than an empty proposal.
      fields: {
        type: "object",
        additionalProperties: false,
        required: ["title", "objective"],
        properties: {
          title: { type: "string" },
          objective: { type: "integer" },
        },
      },
      choices: { objective: ["Raise mid-market activation"] },
    },
  ],
  sources: [],
};

const PROPOSED_ACTION = {
  action: "goals.addKeyResult",
  fields: { title: "Raise activation from 41% to 60%", objective: 1 },
  why: "You asked for this measure on the activation objective.",
};

const proposeAction = evaluationSet<ProposalRequestContext>({
  capability: "proposeAction",
  inputBudgetTokens: 4_000,
  // Says why a proposal was dropped, so a live run that expected one and got
  // none prints the reason beside the failure (plan 0.8.1 A3).
  call: (drafter, context, note) =>
    drafter.proposeAction?.({
      ...context,
      onDropped: (drop) =>
        note(
          `dropped as ${drop.reason}${drop.action ? `, naming ${drop.action}` : ""}`,
        ),
    }),
  fixtures: [
    {
      name: "a request for an offered action",
      context: PROPOSAL,
      reply: json({ propose: true, ...PROPOSED_ACTION }),
      expected: PROPOSED_ACTION,
    },
    {
      name: "an action that was not offered",
      context: PROPOSAL,
      reply: json({
        ...PROPOSED_ACTION,
        propose: true,
        action: "goals.delete",
      }),
      expected: null,
    },
    {
      name: "a question, not a request",
      context: { ...PROPOSAL, request: "How is activation doing?" },
      reply: json({ propose: false, action: "", fields: {}, why: "" }),
      expected: null,
    },
    {
      name: "a proposal with no reason",
      context: PROPOSAL,
      reply: json({ ...PROPOSED_ACTION, propose: true, why: "" }),
      expected: null,
    },
    {
      // Found live on GPT-6 Luna (plan 0.8.1 L7): asked for work behind a
      // key result that was not on the list, it chose the nearest one.
      name: "a request naming an objective that is not on the list",
      context: {
        ...PROPOSAL,
        request: "Add a key result to the partner channel objective",
      },
      reply: json({ propose: false, action: "none", fields: {}, why: "" }),
      expected: null,
    },
  ],
});

const QUESTION: GroundedQuestionContext = {
  question: "How is mid-market activation doing?",
  history: [],
  sources: [
    {
      label: "Raise mid-market activation",
      content: "Activation sits at 41%, behind the 50% target.",
    },
    {
      label: "Cut onboarding time",
      content: "Onboarding takes four days.",
    },
  ],
};

const answerGrounded = evaluationSet<GroundedQuestionContext>({
  capability: "answerGrounded",
  inputBudgetTokens: 4_000,
  call: (drafter, context) => drafter.answerGrounded?.(context),
  fixtures: [
    {
      name: "an answer citing the passage it used",
      context: QUESTION,
      reply: "Activation is at 41%, behind the 50% target [1].\nSOURCES: 1",
      expected: {
        text: "Activation is at 41%, behind the 50% target [1].",
        usedSourceIndexes: [0],
        ...MOCK_ANSWER,
      },
    },
    {
      name: "an answer that forgot the sources line cites nothing",
      context: { ...QUESTION, history: [{ role: "member", content: "Hi" }] },
      reply: "Activation is at 41%.",
      expected: {
        text: "Activation is at 41%.",
        usedSourceIndexes: [],
        ...MOCK_ANSWER,
      },
    },
    {
      name: "a sources line and no answer",
      context: QUESTION,
      reply: "SOURCES: none",
      expected: null,
    },
    // Misreads found live on GPT-6 Luna (plan 0.8.1 L7), each kept as a
    // fixture so a live run asks it again. The check-in one first: asked for
    // "my last check-in", it read somebody else's back as the asker's.
    {
      name: "a check-in the passages do not say is the asker's",
      context: {
        question: "What did my last check-in say?",
        history: [],
        sources: [
          {
            label: "Pipeline eased on 12 May",
            content:
              "S2.1 eased to $2.9M on 12 May: Brightline's launch took $0.5M of late-stage pipeline.",
          },
        ],
      },
      reply:
        "The passages do not show which check-in is yours. One update says S2.1 eased to $2.9M on 12 May [1].\nSOURCES: 1",
      expected: {
        text: "The passages do not show which check-in is yours. One update says S2.1 eased to $2.9M on 12 May [1].",
        usedSourceIndexes: [0],
        ...MOCK_ANSWER,
      },
    },
    {
      // With a card on screen it said "the passages do not specify an
      // objective": the product's note now says a card exists.
      name: "a request the product made a card for",
      context: {
        question: "Create an objective to make partner onboarding self-serve.",
        history: [],
        sources: [],
        proposal: {
          made: true,
          label: "Create an objective",
          preview: [
            { label: "Objective", value: "Make partner onboarding self-serve" },
            { label: "Space", value: "Product" },
          ],
        },
      },
      reply:
        "A change card is ready for you to review and apply: it creates the objective Make partner onboarding self-serve in Product.\nSOURCES: none",
      expected: {
        text: "A change card is ready for you to review and apply: it creates the objective Make partner onboarding self-serve in Product.",
        usedSourceIndexes: [],
        ...MOCK_ANSWER,
      },
    },
    {
      name: "a change the copilot cannot make yet",
      context: {
        question: "Check in on my activation key result at 65%.",
        history: [],
        sources: [],
        proposal: { made: false },
      },
      reply:
        "I cannot make a check-in from here yet. Add it under Check in.\nSOURCES: none",
      expected: {
        text: "I cannot make a check-in from here yet. Add it under Check in.",
        usedSourceIndexes: [],
        ...MOCK_ANSWER,
      },
    },
  ],
});

/** What a stream left the reader with, and the answer it ended on. */
async function streamed(
  drafter: AgentDrafter,
  context: GroundedQuestionContext,
): Promise<{ text: string; answer: GroundedAnswer | null } | undefined> {
  const chunks = drafter.streamGrounded?.(context);
  if (!chunks) {
    return undefined;
  }
  let text = "";
  let answer: GroundedAnswer | null = null;
  for await (const chunk of chunks) {
    if (chunk.kind === "text") {
      text += chunk.text;
    } else {
      answer = chunk.answer;
    }
  }
  return { text, answer };
}

const streamGrounded = evaluationSet<GroundedQuestionContext>({
  capability: "streamGrounded",
  inputBudgetTokens: 4_000,
  call: streamed,
  fixtures: [
    {
      name: "the sources line never reaches the reader",
      context: QUESTION,
      reply: [
        "Activation is at 41%",
        ", behind the target [1].",
        "\nSOURCES: 1",
      ],
      expected: {
        text: "Activation is at 41%, behind the target [1].",
        answer: {
          text: "Activation is at 41%, behind the target [1].",
          usedSourceIndexes: [0],
          // What the mock counted, now that a streamed answer carries it
          // (plan 0.8.1 W1), as a whole answer always has.
          ...MOCK_ANSWER,
        },
      },
    },
    {
      name: "an answer with no sources line cites nothing",
      context: QUESTION,
      reply: ["Nothing in the passages ", "says that."],
      expected: {
        text: "Nothing in the passages says that.",
        answer: {
          text: "Nothing in the passages says that.",
          usedSourceIndexes: [],
          // What the mock counted, now that a streamed answer carries it
          // (plan 0.8.1 W1), as a whole answer always has.
          ...MOCK_ANSWER,
        },
      },
    },
  ],
});

const GOALS: readonly ReviewableGoal[] = [
  {
    title: "Win the mid-market",
    description: "",
    level: "company",
    spaceName: null,
    parentIndex: null,
    keyResultTitles: ["Close 40 mid-market logos"],
  },
  {
    title: "Raise mid-market activation",
    description: "New accounts reach value in their first week.",
    level: "department",
    spaceName: "Customer Success",
    parentIndex: null,
    keyResultTitles: ["Activation from 41% to 60%"],
  },
];

const FINDINGS = [
  {
    kind: "relink",
    subjectIndex: 1,
    targetIndex: 0,
    severity: "medium",
    reason: "Activation is how the mid-market is won, and it has no parent.",
  },
];

const reviewAlignment = evaluationSet<readonly ReviewableGoal[]>({
  capability: "reviewAlignment",
  inputBudgetTokens: 4_000,
  call: (drafter, context) => drafter.reviewAlignment?.(context),
  fixtures: [
    {
      name: "a department objective with no parent",
      context: GOALS,
      reply: json({ findings: FINDINGS }),
      expected: FINDINGS,
    },
    {
      // Empty is a real answer, and it clears a finding still open.
      name: "nothing found",
      context: GOALS,
      reply: json({ findings: [] }),
      expected: [],
    },
    {
      name: "a finding of a kind the alignment checks do not have",
      context: GOALS,
      reply: json({ findings: [{ ...FINDINGS[0], kind: "vibes" }] }),
      expected: null,
    },
  ],
});

/** Every set, in the order AI-NATIVE-PLAN §2 lists the capabilities. */
export const EVALUATION_SETS: readonly EvaluationSet[] = [
  draftObjective,
  rewriteForRule,
  suggestMeasure,
  suggestParent,
  draftCheckIn,
  refineRecoveryTitle,
  narrateDigest,
  narrateTrend,
  summariseBlockers,
  suggestKpi,
  planRun,
  clusterNotes,
  narrateDiagnostic,
  draftMinutes,
  draftRetrospective,
  proposeObjectives,
  summariseThread,
  decomposeKeyResult,
  parseListFilter,
  proposeImportMapping,
  proposeAction,
  answerGrounded,
  streamGrounded,
  reviewAlignment,
];
