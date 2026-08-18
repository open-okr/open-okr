import { type DraftVerdict, draftVerdict } from "./scoring.ts";
import type { CoachStrictness, ResolvedThresholds } from "./thresholds.ts";

/**
 * METHOD.md §4's quality catalogue, as data and pure functions (P4-T01).
 *
 * The same array drives three surfaces: the Draft Coach as somebody types, the
 * server before a write, and the conformance suite. One catalogue means a rule
 * cannot say one thing in the browser and another on the server.
 *
 * **Every condition carries its coaching prompt, verbatim from METHOD.md.** A
 * verdict with no prompt is a rejection with no way out, and §4 never does
 * that: it names the problem, asks the question that exposes it, and cites the
 * rule. The prompts are the product's voice, so they live beside the condition
 * rather than in a surface that could drift from it.
 *
 * Condition tables are **first match wins**, in the order METHOD.md lists them.
 */

export type QualityStatus = "pass" | "warn" | "fail" | "todo";

export interface ConditionRow {
  /** What the reader would call the case, for the rule card. */
  readonly condition: string;
  readonly status: QualityStatus;
  /** The coaching message, verbatim from METHOD.md §4. */
  readonly prompt: string;
}

export interface QualityCheck {
  readonly id: string;
  readonly group: "objective" | "key_result" | "alignment" | "cycle";
  readonly title: string;
  /**
   * §4's strength score counts objective, key result and alignment checks.
   * The cycle checks feed phase completion and the publish gates instead.
   */
  readonly feedsStrengthScore: boolean;
  readonly conditions: readonly ConditionRow[];
}

export interface QualityVerdict {
  readonly id: string;
  readonly status: QualityStatus;
  readonly prompt: string;
  readonly feedsStrengthScore: boolean;
}

/**
 * §4.1's four word lists.
 *
 * Not §11 parameters: the registry holds numbers the practice fires on, and a
 * word list is data. A workspace adds terms through a §4.14 setting; the canon
 * terms remain.
 */
export const QUALITY_WORD_LISTS = {
  outputVerbs: [
    "launch",
    "build",
    "ship",
    "implement",
    "create",
    "deliver",
    "release",
    "complete",
    "develop",
    "deploy",
    "write",
    "publish",
    "migrate",
    "install",
    "conduct",
    "hold",
    "organise",
    "organize",
    "set up",
    "roll out",
    "rollout",
    "hire",
    "redesign",
    "finish",
    "produce",
    "run",
  ],
  movementVerbs: [
    "increase",
    "grow",
    "improve",
    "reduce",
    "boost",
    "raise",
    "cut",
    "double",
    "triple",
    "maximise",
    "maximize",
    "minimise",
    "minimize",
    "decrease",
    "accelerate",
    "expand",
    "drive",
  ],
  stateWords: [
    "become",
    "be the",
    "delight",
    "delighted",
    "loved",
    "trusted",
    "leading",
    "best",
    "strongest",
    "profitable",
    "sustainable",
    "engaged",
    "thriving",
    "world-class",
    "preferred",
    "go-to",
    "healthiest",
    "excellence",
    "dominant",
    "known for",
    "famous for",
    "proud",
  ],
  whyMarkers: ["to", "so that", "in order to", "because"],
  /**
   * §4.2's list, which ends "(and plurals)". The plurals are written out
   * rather than derived, because the matcher is whole-word and an -s rule
   * would have to know that "activity" pluralises to "activities". A list
   * somebody can read and correct beats a rule somebody has to debug.
   */
  activityNouns: [
    "call",
    "calls",
    "meeting",
    "meetings",
    "interview",
    "interviews",
    "demo",
    "demos",
    "email",
    "emails",
    "workshop",
    "workshops",
    "session",
    "sessions",
    "training",
    "trainings",
    "webinar",
    "webinars",
    "post",
    "posts",
    "visit",
    "visits",
    "proposal",
    "proposals",
    "campaign",
    "campaigns",
    "feature",
    "features",
    "report",
    "reports",
    "presentation",
    "presentations",
    "event",
    "events",
    "ticket",
    "tickets",
    "article",
    "articles",
    "sprint",
    "sprints",
    "task",
    "tasks",
    "activity",
    "activities",
    "outreach",
    "touchpoint",
    "touchpoints",
  ],
  impactWords: [
    "revenue",
    "pipeline",
    "conversion",
    "retention",
    "churn",
    "nps",
    "csat",
    "satisfaction",
    "margin",
    "profit",
    "growth",
    "adoption",
    "activation",
    "engagement",
    "win rate",
    "quality",
    "insight",
    "market share",
    "loyalty",
    "renewal",
    "upsell",
    "arr",
    "mrr",
    "ltv",
    "cac",
    "accuracy",
    "uptime",
    "productivity",
    "time-to-value",
    "referrals",
    "deal size",
  ],
} as const;

export const OBJECTIVE_CHECKS: readonly QualityCheck[] = [
  {
    id: "OBJ-1",
    group: "objective",
    title: "Outcome, not output",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "Starts with an output verb",
        status: "fail",
        prompt:
          "Your objective starts with a deliverable, not a destination. If we do it and nothing changes, did we succeed? Rewrite around the change you want.",
      },
      {
        condition: "Bare metric movement, no why",
        status: "fail",
        prompt:
          "Naming a metric to move is a key result in disguise. The outcome is the why behind the movement. Add the why, or lead with the end state.",
      },
      {
        condition: "Metric movement with a why",
        status: "pass",
        prompt:
          "You have paired movement with a why. Stronger still: lead with the end state and let the key results carry the movement.",
      },
      {
        condition: "Names a change in state",
        status: "pass",
        prompt:
          "This reads as a change in state, not a to-do. Keep the deliverables in your key results.",
      },
      {
        condition: "Contains an output verb anywhere",
        status: "warn",
        prompt:
          "There is output language here. What would be true after this is done? Lead with that.",
      },
      {
        condition: "Cannot tell",
        status: "warn",
        prompt:
          "Could you complete this without anything actually improving? If yes, rewrite around the improvement.",
      },
    ],
  },
  {
    id: "OBJ-2",
    group: "objective",
    title: "Inspiring and directional",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "Contains digits",
        status: "warn",
        prompt:
          "Metrics belong in the key results. Keep the objective qualitative and memorable.",
      },
      {
        condition: "Fewer than 4 words",
        status: "warn",
        prompt:
          "Very short. Would someone outside your team understand where you are headed and why it matters?",
      },
      {
        condition: "More than 18 words",
        status: "warn",
        prompt:
          "Trim it. If your team cannot recite it from memory, it will not steer their daily decisions.",
      },
      {
        condition: "4 to 18 words, no digits",
        status: "pass",
        prompt:
          "Good length and qualitative. Read it aloud. Would it make your team lean in?",
      },
    ],
  },
  {
    id: "OBJ-3",
    group: "objective",
    title: "Timebound",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "No cycle and no explicit timeframe",
        status: "fail",
        prompt:
          "An OKR without a deadline is a wish. Put it in a cycle, or state the window it runs in.",
      },
      {
        condition: "In a cycle or carrying a timeframe",
        status: "pass",
        prompt:
          "This is timebound, so it can be reviewed rather than drifting.",
      },
    ],
  },
  {
    id: "OBJ-4",
    group: "objective",
    title: "Owned",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "No named champion",
        status: "fail",
        prompt:
          "Nobody owns this. Name the champion who reports on it, or it belongs to everyone and therefore to no one.",
      },
      {
        condition: "No named reviewer",
        status: "fail",
        prompt:
          "No reviewer means no one acknowledges the check-ins. Name the person who reads them.",
      },
      {
        condition: "Champion and reviewer named",
        status: "pass",
        prompt: "Owned and reviewed, so the loop closes on somebody.",
      },
    ],
  },
  {
    id: "OBJ-5",
    group: "objective",
    title: "Counted",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "Company level above the company cap",
        status: "fail",
        prompt:
          "Too many objectives at company level. Which of these would you drop if you had to choose? Drop them.",
      },
      {
        condition: "Above the per-unit cap",
        status: "warn",
        prompt:
          "More objectives than a unit can hold in mind at once. Focus is what makes this work.",
      },
      {
        condition: "Within the cap",
        status: "pass",
        prompt: "A count a team can actually hold in mind.",
      },
    ],
  },
];

/**
 * §4.2's seven checks.
 *
 * Where METHOD.md quotes a coaching prompt, it is here verbatim. Where it
 * words the rule in prose and gives no prompt (KR-3, KR-7, and the pass rows
 * of KR-1, KR-2 and KR-4), the prompt is composed from METHOD's own sentence
 * for that rule and nothing else. That is the same treatment OBJ-3, OBJ-4 and
 * OBJ-5 already had. A row cannot carry no prompt: the data shape refuses it,
 * because a verdict without a way forward is the one thing §4 never does.
 */
export const KEY_RESULT_CHECKS: readonly QualityCheck[] = [
  {
    id: "KR-1",
    group: "key_result",
    title: "Count",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "None at all",
        status: "fail",
        prompt:
          "An objective with no key results is an intention. How will you know, at the end of the cycle, whether it happened?",
      },
      {
        condition: "Above the upper bound",
        status: "fail",
        prompt: "Which two would you drop if you had to? Drop them.",
      },
      {
        condition: "Exactly one",
        status: "warn",
        prompt: "Can a single measure prove this from every angle?",
      },
      {
        condition: "Within the bounds",
        status: "pass",
        prompt:
          "A count that proves the objective from more than one angle without becoming a to-do list.",
      },
    ],
  },
  {
    id: "KR-2",
    group: "key_result",
    title: "Measurable",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "No numbers",
        status: "fail",
        prompt: "What is the baseline today, and where must it land?",
      },
      {
        condition: "A single number",
        status: "warn",
        prompt:
          "A target but no baseline. Without the from, you cannot prove movement.",
      },
      {
        condition: "From X to Y, or two numbers",
        status: "pass",
        prompt:
          "This carries both ends, so the movement between them is the thing being measured.",
      },
    ],
  },
  {
    id: "KR-3",
    group: "key_result",
    title: "Complete",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "Baseline, target, date or owner missing",
        status: "fail",
        prompt:
          "Something is missing: a baseline, a target, a date or an owner. If the baseline is unknown, establishing it can be the first key result.",
      },
      {
        condition: "All four present",
        status: "pass",
        prompt:
          "Baseline, target, date and owner are all here, so this can be checked in on rather than argued about.",
      },
    ],
  },
  {
    id: "KR-4",
    group: "key_result",
    title: "Leading and lagging mix",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "Untagged",
        status: "fail",
        prompt:
          "This one is neither leading nor lagging. Tag it, or the set cannot say whether it will find out in time.",
      },
      {
        condition: "All lagging",
        status: "warn",
        prompt:
          "You will only find out at the end of the cycle whether it worked.",
      },
      {
        condition: "All leading",
        status: "warn",
        prompt: "Which key result proves the actual outcome landed?",
      },
      {
        condition: "At least one of each",
        status: "pass",
        prompt:
          "One of each, so you get an early signal and a final answer rather than only one of them.",
      },
    ],
  },
  {
    id: "KR-5",
    group: "key_result",
    title: "Impact, not effort",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "Activity noun, no impact word, no purpose",
        status: "fail",
        prompt:
          "This measures pure activity volume. That is an output however measurable it is. Ask why: more calls, to what end? Name that impact and make it the key result.",
      },
      {
        condition: "Output verb with fewer than two numbers",
        status: "warn",
        prompt:
          "Reads like a milestone. What measurably changes because of it? Measure that instead.",
      },
      {
        condition: "Activity plus a why, but the target sits on the activity",
        status: "warn",
        prompt:
          "Good instinct, but flip it. Measure the impact itself and keep the activity as a clearly tagged leading indicator at most.",
      },
      {
        condition: "Otherwise",
        status: "pass",
        prompt: "These measure impact, not activity.",
      },
    ],
  },
  {
    id: "KR-6",
    group: "key_result",
    title: "Ambitious but honest",
    feedsStrengthScore: true,
    // §3.2's own second column, one row per draft verdict. The status is not in
    // METHOD: only the sweet spot reads as an answer rather than a question, so
    // it is the pass and the other four are warns. None fails, because §3.2
    // never refuses a set on its confidence and the publish gates are separate.
    conditions: [
      {
        condition: "Nobody has set a confidence yet",
        status: "todo",
        prompt:
          "No confidence set yet. Ask the owners how likely they think each one is, and judge the set rather than any single key result.",
      },
      {
        condition: "Sandbagging",
        status: "warn",
        prompt:
          "If you are near certain, this is business as usual, not an OKR. Raise the targets.",
      },
      {
        condition: "Comfortable",
        status: "warn",
        prompt: "Stretch until it feels like a 6 or 7 out of 10.",
      },
      {
        condition: "The sweet spot",
        status: "pass",
        prompt: "A real stretch you still believe in.",
      },
      {
        condition: "Ambitious",
        status: "warn",
        prompt: "Check that the team genuinely believes it is possible.",
      },
      {
        condition: "Moonshot",
        status: "warn",
        prompt:
          "A moonshot bordering on fantasy. Make sure there is a credible path.",
      },
    ],
  },
  {
    id: "KR-7",
    group: "key_result",
    title: "Direction set",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "No direction",
        status: "fail",
        prompt:
          "Set the direction: increase, reduce, maintain or move. Without it, nothing can say whether a number arriving is good news.",
      },
      {
        condition: "Direction set",
        status: "pass",
        prompt:
          "The direction is set, so progress can be read from the number itself.",
      },
    ],
  },
];

export interface ObjectiveInput {
  readonly title: string;
  readonly hasCycle: boolean;
  readonly hasTimeframe: boolean;
  readonly championId: string | null;
  readonly reviewerId: string | null;
  /** How many objectives this unit already has, including this one. */
  readonly objectivesInUnit: number;
  readonly level: "company" | "department" | "team" | "individual";
}

const words = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");

/** Whole-word or whole-phrase containment, so "run" never matches "running". */
const contains = (text: string, terms: readonly string[]): boolean => {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ")} `;
  return terms.some((term) => lower.includes(` ${term} `));
};

const startsWith = (text: string, terms: readonly string[]): boolean => {
  const lower = text.toLowerCase().trimStart();
  return terms.some((term) => lower === term || lower.startsWith(`${term} `));
};

const rowOf = (check: QualityCheck, condition: string): ConditionRow => {
  const row = check.conditions.find((entry) => entry.condition === condition);
  if (!row) {
    // A condition the catalogue does not carry would mean the evaluator and
    // the rule card disagree, which is the drift this shape exists to prevent.
    throw new Error(`${check.id} has no condition "${condition}"`);
  }
  return row;
};

const verdictOf = (check: QualityCheck, condition: string): QualityVerdict => {
  const row = rowOf(check, condition);
  return {
    id: check.id,
    status: row.status,
    prompt: row.prompt,
    feedsStrengthScore: check.feedsStrengthScore,
  };
};

const check = (id: string): QualityCheck => {
  const found = [
    ...OBJECTIVE_CHECKS,
    ...KEY_RESULT_CHECKS,
    ...ALIGNMENT_CHECKS,
    ...CYCLE_CHECKS,
  ].find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`No such check: ${id}`);
  }
  return found;
};

/**
 * §4.1's five objective checks, first match wins within each.
 *
 * The order inside OBJ-1 is the order METHOD.md lists, with one exception that
 * matters: "starts with an output verb" is tested before "contains one
 * anywhere", because a title that starts with one also contains one and the
 * stronger verdict has to win. METHOD.md's own table reads the same way.
 */
export function evaluateObjective(
  input: ObjectiveInput,
  thresholds: ResolvedThresholds,
): readonly QualityVerdict[] {
  const title = input.title.trim();
  const wordCount = words(title).length;
  // A quarter label is a time reference, not a metric, so it does not trip
  // OBJ-2. The approved corpus says so in as many words on entry 1: "Launch the
  // new mobile app by end of Q3" is scored "no digits (Q3 is not a digit)".
  // Without this, every objective that names its own quarter would be warned
  // for the one thing OBJ-3 asks it to do.
  const hasDigits = /\d/.test(title.replace(/\bQ[1-4]\b/gi, ""));
  const lists = QUALITY_WORD_LISTS;

  // OBJ-1
  const obj1 = check("OBJ-1");
  const startsOutput = startsWith(title, lists.outputVerbs);
  const startsMovement = startsWith(title, lists.movementVerbs);
  const hasWhy = contains(title, lists.whyMarkers);
  const hasState = contains(title, lists.stateWords);
  const obj1Verdict = startsOutput
    ? verdictOf(obj1, "Starts with an output verb")
    : startsMovement && hasDigits && !hasWhy
      ? verdictOf(obj1, "Bare metric movement, no why")
      : startsMovement && hasWhy
        ? verdictOf(obj1, "Metric movement with a why")
        : hasState
          ? verdictOf(obj1, "Names a change in state")
          : contains(title, lists.outputVerbs)
            ? verdictOf(obj1, "Contains an output verb anywhere")
            : verdictOf(obj1, "Cannot tell");

  // OBJ-2. The bounds are the §11 registry's, not this function's: METHOD.md
  // §4.1 words them as four and eighteen and the registry carries those as
  // `quality.objectiveLengthWords`, so a workspace that tunes them tunes the
  // check rather than being ignored by it.
  const obj2 = check("OBJ-2");
  const length = thresholds["quality.objectiveLengthWords"];
  const obj2Verdict = hasDigits
    ? verdictOf(obj2, "Contains digits")
    : wordCount < length.low
      ? verdictOf(obj2, "Fewer than 4 words")
      : wordCount > length.high
        ? verdictOf(obj2, "More than 18 words")
        : verdictOf(obj2, "4 to 18 words, no digits");

  // OBJ-3
  const obj3 = check("OBJ-3");
  const obj3Verdict =
    input.hasCycle || input.hasTimeframe
      ? verdictOf(obj3, "In a cycle or carrying a timeframe")
      : verdictOf(obj3, "No cycle and no explicit timeframe");

  // OBJ-4
  const obj4 = check("OBJ-4");
  const obj4Verdict = !input.championId
    ? verdictOf(obj4, "No named champion")
    : !input.reviewerId
      ? verdictOf(obj4, "No named reviewer")
      : verdictOf(obj4, "Champion and reviewer named");

  // OBJ-5
  const obj5 = check("OBJ-5");
  const perUnit = thresholds["quality.objectivesPerUnitCap"];
  const companyCap = thresholds["quality.companyObjectiveCap"];
  const obj5Verdict =
    input.level === "company" && input.objectivesInUnit > companyCap
      ? verdictOf(obj5, "Company level above the company cap")
      : input.objectivesInUnit > perUnit
        ? verdictOf(obj5, "Above the per-unit cap")
        : verdictOf(obj5, "Within the cap");

  return [obj1Verdict, obj2Verdict, obj3Verdict, obj4Verdict, obj5Verdict];
}

export interface KeyResultInput {
  readonly text: string;
  readonly baseline: number | null;
  readonly target: number | null;
  readonly dueOn: string | null;
  readonly ownerId: string | null;
  readonly indicatorType: "leading" | "lagging" | null;
  readonly direction: "increase" | "reduce" | "maintain" | "move" | null;
  /** Null until somebody has answered. KR-6 stays `todo` while it is. */
  readonly confidence: number | null;
}

export interface KeyResultSetInput {
  readonly keyResults: readonly KeyResultInput[];
}

export interface KeyResultVerdict extends QualityVerdict {
  /**
   * Which key results tripped this, by their index in the input. Empty on a
   * set-level check and on anything that passed. §4.2's four per-key-result
   * checks are useless to a writer without it: "one of these has no baseline"
   * is not coaching until it says which one.
   */
  readonly keyResults: readonly number[];
}

/** How many separate numbers the text carries, for KR-2 and KR-5. */
const numbersIn = (text: string): number =>
  (text.match(/\d+(?:[.,]\d+)?/g) ?? []).length;

const WORST: Record<QualityStatus, number> = {
  pass: 0,
  todo: 1,
  warn: 2,
  fail: 3,
};

/**
 * Roll a per-key-result check up to one verdict for the set.
 *
 * The worst status wins and carries its own prompt, which is why the offenders
 * are listed separately: the writer needs the prompt for the problem and the
 * index of the key result that has it.
 */
const rollUp = (
  id: string,
  perKeyResult: readonly { condition: string; index: number }[],
): KeyResultVerdict => {
  const found = check(id);
  const rows = perKeyResult.map((entry) => ({
    ...entry,
    row: rowOf(found, entry.condition),
  }));
  const first = rows[0];
  if (!first) {
    // No key results at all: only KR-1 has anything to say, and it says it.
    // Everything else is waiting on input, which is what `todo` is for.
    return {
      id,
      status: "todo",
      prompt: found.conditions[0]?.prompt ?? "",
      feedsStrengthScore: found.feedsStrengthScore,
      keyResults: [],
    };
  }
  const worst = rows.reduce(
    (carry, entry) =>
      WORST[entry.row.status] > WORST[carry.row.status] ? entry : carry,
    first,
  );
  return {
    id,
    status: worst.row.status,
    prompt: worst.row.prompt,
    feedsStrengthScore: found.feedsStrengthScore,
    keyResults:
      worst.row.status === "pass"
        ? []
        : rows
            .filter((entry) => entry.row.status !== "pass")
            .map((entry) => entry.index),
  };
};

/**
 * §4.2's seven key result checks over one objective's set.
 *
 * KR-1, KR-4 and KR-6 judge the set. KR-2, KR-3, KR-5 and KR-7 judge each key
 * result and roll up to the worst, naming the offenders. That split is
 * METHOD's own: KR-4 asks whether the *set* holds one of each, and KR-2 asks
 * whether *this text* reads from X to Y.
 */
export function evaluateKeyResults(
  input: KeyResultSetInput,
  thresholds: ResolvedThresholds,
): readonly KeyResultVerdict[] {
  const set = input.keyResults;
  const indexes = set.map((_, index) => index);
  const lists = QUALITY_WORD_LISTS;

  // KR-1
  const kr1 = check("KR-1");
  const bounds = thresholds["quality.keyResultsPerObjective"];
  const kr1Row =
    set.length === 0
      ? "None at all"
      : set.length > bounds.high
        ? "Above the upper bound"
        : set.length < bounds.low
          ? "Exactly one"
          : "Within the bounds";
  const kr1Verdict: KeyResultVerdict = {
    ...verdictOf(kr1, kr1Row),
    keyResults: [],
  };

  // KR-2. "From X to Y" is two numbers with the words between them, so both
  // arms of METHOD's pass condition reduce to the same count.
  const kr2 = rollUp(
    "KR-2",
    indexes.map((index) => {
      const count = numbersIn(set[index]?.text ?? "");
      return {
        index,
        condition:
          count === 0
            ? "No numbers"
            : count === 1
              ? "A single number"
              : "From X to Y, or two numbers",
      };
    }),
  );

  // KR-3
  const kr3 = rollUp(
    "KR-3",
    indexes.map((index) => {
      const entry = set[index] as KeyResultInput;
      const complete =
        entry.baseline !== null &&
        entry.target !== null &&
        entry.dueOn !== null &&
        entry.ownerId !== null;
      return {
        index,
        condition: complete
          ? "All four present"
          : "Baseline, target, date or owner missing",
      };
    }),
  );

  // KR-4. The untagged case is per key result and the mix is not, so this one
  // is built by hand rather than through `rollUp`.
  const kr4Check = check("KR-4");
  const untagged = indexes.filter((index) => !set[index]?.indicatorType);
  const leading = set.filter((entry) => entry.indicatorType === "leading");
  const lagging = set.filter((entry) => entry.indicatorType === "lagging");
  const kr4Row =
    set.length === 0 || untagged.length > 0
      ? "Untagged"
      : leading.length > 0 && lagging.length > 0
        ? "At least one of each"
        : lagging.length > 0
          ? "All lagging"
          : "All leading";
  const kr4: KeyResultVerdict = {
    ...verdictOf(kr4Check, kr4Row),
    keyResults: kr4Row === "Untagged" ? untagged : [],
  };

  // KR-5
  const kr5 = rollUp(
    "KR-5",
    indexes.map((index) => {
      const text = set[index]?.text ?? "";
      const activity = contains(text, lists.activityNouns);
      const impact = contains(text, lists.impactWords);
      const why = contains(text, lists.whyMarkers);
      const output = contains(text, lists.outputVerbs);
      const count = numbersIn(text);
      return {
        index,
        condition:
          activity && !impact && !why
            ? "Activity noun, no impact word, no purpose"
            : output && count < 2
              ? "Output verb with fewer than two numbers"
              : activity && why
                ? "Activity plus a why, but the target sits on the activity"
                : "Otherwise",
      };
    }),
  );

  // KR-6. The set average, never one key result: §3.2 says so in as many words.
  const kr6Check = check("KR-6");
  const answered = set.filter((entry) => entry.confidence !== null);
  const kr6Row =
    answered.length === 0
      ? "Nobody has set a confidence yet"
      : DRAFT_VERDICT_CONDITIONS[
          draftVerdict(
            answered.reduce((sum, entry) => sum + (entry.confidence ?? 0), 0) /
              answered.length,
            thresholds,
          )
        ];
  const kr6: KeyResultVerdict = {
    ...verdictOf(kr6Check, kr6Row),
    keyResults: [],
  };

  // KR-7
  const kr7 = rollUp(
    "KR-7",
    indexes.map((index) => ({
      index,
      condition: set[index]?.direction ? "Direction set" : "No direction",
    })),
  );

  return [kr1Verdict, kr2, kr3, kr4, kr5, kr6, kr7];
}

/** §3.2's five draft verdicts, named as KR-6's condition rows. */
const DRAFT_VERDICT_CONDITIONS: Record<DraftVerdict, string> = {
  sandbagging: "Sandbagging",
  comfortable: "Comfortable",
  sweet_spot: "The sweet spot",
  ambitious: "Ambitious",
  moonshot: "Moonshot",
};

/**
 * METHOD.md §4: "In strict mode every warn becomes a fail."
 *
 * That one sentence is the whole rule, and the prompt is unchanged by it: the
 * problem the writer has is the same problem whether it blocks or not, so the
 * coaching stays and only the consequence moves.
 *
 * `advisory` is in the §11 enum and METHOD.md never says what it does. It is
 * the identity here rather than a guessed demotion, and that gap is recorded
 * on the P4-T01 row as a question for a human. Inventing a rule would put
 * practice in the code instead of in the document.
 */
export function applyStrictness<T extends QualityVerdict>(
  verdicts: readonly T[],
  strictness: CoachStrictness,
): readonly T[] {
  if (strictness !== "strict") {
    return verdicts;
  }
  return verdicts.map((entry) =>
    entry.status === "warn" ? { ...entry, status: "fail" as const } : entry,
  );
}

/**
 * METHOD.md §4: `(passes + 0.5 × warns) / evaluated checks`, as a percentage.
 *
 * A `todo` counts in the denominator and adds nothing, because a check nobody
 * has answered is not a check that passed. Cycle checks are excluded: they feed
 * phase completion and the publish gates instead.
 */
export function strengthScore(
  verdicts: readonly QualityVerdict[],
): number | null {
  const counted = verdicts.filter((entry) => entry.feedsStrengthScore);
  if (counted.length === 0) {
    return null;
  }
  const passes = counted.filter((entry) => entry.status === "pass").length;
  const warns = counted.filter((entry) => entry.status === "warn").length;
  return Math.round(((passes + 0.5 * warns) / counted.length) * 100);
}

/**
 * §4.3's six alignment checks.
 *
 * These are a **directory, not a second implementation.** Four of them are
 * already decided by the alignment engine in `alignment.ts`, which emits a
 * finding keyed AL-1, AL-3, AL-4 or AL-6 and prices it against the §11 penalty
 * table. Re-deciding them here is exactly the drift one catalogue exists to
 * prevent, so `evaluateAlignment` reads that engine's findings rather than the
 * graph.
 *
 * The two that are not in the engine say so in their own rows. AL-2 is a
 * database check constraint, so a goal with two parents cannot be stored and
 * there is nothing left to warn about at drafting time. AL-5 is the dependency
 * register, which the publish gates already hold; CY-7 is the same rule read
 * from the cycle's side.
 */
export const ALIGNMENT_CHECKS: readonly QualityCheck[] = [
  {
    id: "AL-1",
    group: "alignment",
    title: "Supports a bigger priority",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "No parent and no stated contribution",
        status: "fail",
        prompt:
          "What bigger priority does this support? If nothing comes to mind, that is the biggest red flag on this page.",
      },
      {
        condition: "Stated contribution under three words",
        status: "warn",
        prompt:
          "Growth is not a priority, it is a word. Which growth goal, whose?",
      },
      {
        condition: "Parent or a stated contribution",
        status: "pass",
        prompt:
          "This says what it supports, so somebody above it can see why it exists.",
      },
    ],
  },
  {
    id: "AL-2",
    group: "alignment",
    title: "One parent only",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "Enforced in the schema",
        status: "pass",
        prompt:
          "A goal aligns under one parent goal, or one parent key result, or neither. Never both, and the database refuses to store anything else.",
      },
    ],
  },
  {
    id: "AL-3",
    group: "alignment",
    title: "No level skip",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "Skips a level",
        status: "warn",
        prompt:
          "This skips a level. A team goal aligns to a department goal, not straight to a company one, or the department in between cannot see what it owns.",
      },
      {
        condition: "Aligned one level up",
        status: "pass",
        prompt: "Aligned one level up, so nothing in between is bypassed.",
      },
    ],
  },
  {
    id: "AL-4",
    group: "alignment",
    title: "Company anchor",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "No company-level objective",
        status: "fail",
        prompt:
          "Nothing anchors this tree. At least one company-level objective has to sit at the top, or every alignment below it points at nothing.",
      },
      {
        condition: "Anchored",
        status: "pass",
        prompt: "A company-level objective anchors the tree.",
      },
    ],
  },
  {
    id: "AL-5",
    group: "alignment",
    title: "Dependencies declared",
    feedsStrengthScore: true,
    conditions: [
      {
        condition:
          "A cross-team dependency is neither confirmed nor risk-owned",
        status: "fail",
        prompt:
          "A cross-team dependency is neither confirmed by the providing team nor logged as a risk with a named owner. Get one or the other before this is published.",
      },
      {
        condition: "Every dependency confirmed or risk-owned",
        status: "pass",
        prompt:
          "Every cross-team dependency is either confirmed or owned as a risk.",
      },
    ],
  },
  {
    id: "AL-6",
    group: "alignment",
    title: "Not siloed",
    feedsStrengthScore: true,
    conditions: [
      {
        condition: "A department subtree with no horizontal dependency",
        status: "warn",
        prompt:
          "This department depends on nobody and nobody depends on it. Possible silo. Is that really true, or has the dependency simply never been written down?",
      },
      {
        condition: "Horizontal dependencies present",
        status: "pass",
        prompt: "This department is connected sideways, not only upwards.",
      },
    ],
  },
];

export interface AlignmentCheckInput {
  /** Straight from `alignmentScore`. The engine decides; this reports. */
  readonly findings: readonly { readonly ruleKey: string }[];
  /**
   * AL-5's answer, which lives in the dependency register rather than in the
   * alignment graph. Null while nobody has been asked, which is a `todo`
   * rather than a pass: an unanswered check never counts as answered.
   */
  readonly everyDependencyResolved: boolean | null;
}

/** The condition each engine finding maps to, by rule key. */
const ALIGNMENT_FINDING_CONDITIONS: Record<string, string> = {
  "AL-1": "No parent and no stated contribution",
  "AL-3": "Skips a level",
  "AL-4": "No company-level objective",
  "AL-6": "A department subtree with no horizontal dependency",
};

/**
 * §4.3 as verdicts, read from what the alignment engine already found.
 *
 * A rule with no finding against it passed: the engine walks the whole graph
 * and prices everything it objects to, so silence is an answer rather than an
 * absence. AL-2 is always a pass because the schema refuses the alternative,
 * and AL-5 comes from the register the caller passes in.
 */
export function evaluateAlignment(
  input: AlignmentCheckInput,
): readonly QualityVerdict[] {
  const raised = new Set(input.findings.map((finding) => finding.ruleKey));
  return ALIGNMENT_CHECKS.map((entry) => {
    if (entry.id === "AL-2") {
      return verdictOf(entry, "Enforced in the schema");
    }
    if (entry.id === "AL-5") {
      if (input.everyDependencyResolved === null) {
        return {
          id: entry.id,
          status: "todo" as const,
          prompt:
            "Nobody has answered whether the cross-team dependencies are confirmed or risk-owned yet.",
          feedsStrengthScore: entry.feedsStrengthScore,
        };
      }
      return verdictOf(
        entry,
        input.everyDependencyResolved
          ? "Every dependency confirmed or risk-owned"
          : "A cross-team dependency is neither confirmed nor risk-owned",
      );
    }
    const failing = ALIGNMENT_FINDING_CONDITIONS[entry.id];
    if (failing && raised.has(entry.id)) {
      return verdictOf(entry, failing);
    }
    // The passing row is the last one in every alignment check.
    const passing = entry.conditions[entry.conditions.length - 1];
    return {
      id: entry.id,
      status: passing?.status ?? "pass",
      prompt: passing?.prompt ?? "",
      feedsStrengthScore: entry.feedsStrengthScore,
    };
  });
}

/**
 * §4.4's eight cycle checks.
 *
 * These do not feed the strength score. §4 counts objective, key result and
 * alignment checks; the cycle checks feed phase completion and the publish
 * gates, which is a different question. Not "is this OKR any good" but "is this
 * cycle ready to run".
 *
 * Two of them are already decided by `publishGates`, and `evaluateCycle`
 * delegates rather than deciding again: CY-6 is gate 5 and CY-7 is gate 4. The
 * other six read the same §11 parameters the phase predicates read, so the two
 * cannot disagree about a number, and a test asserts they agree about the
 * answer as well.
 */
export const CYCLE_CHECKS: readonly QualityCheck[] = [
  {
    id: "CY-1",
    group: "cycle",
    title: "Input pack complete",
    feedsStrengthScore: false,
    conditions: [
      {
        condition: "Items missing, or distributed too late",
        status: "fail",
        prompt:
          "The input pack is not ready. Complete it and get it to people the working days ahead that §2.6 asks for, or session one becomes the meeting where everybody reads.",
      },
      {
        condition: "Complete and distributed in time",
        status: "pass",
        prompt:
          "The pack is complete and reached people early enough to have been read.",
      },
    ],
  },
  {
    id: "CY-2",
    group: "cycle",
    title: "Prior cycle scored",
    feedsStrengthScore: false,
    conditions: [
      {
        condition: "Neither scored nor declared a first cycle",
        status: "fail",
        prompt:
          "Score the previous cycle before planning the next, or say in as many words that this is the first. Planning without closing the last one throws away the only evidence you have.",
      },
      {
        condition: "Scored, or declared the first cycle",
        status: "pass",
        prompt:
          "The previous cycle is closed, so this one starts from evidence rather than from memory.",
      },
    ],
  },
  {
    id: "CY-3",
    group: "cycle",
    title: "Strategic issues",
    feedsStrengthScore: false,
    conditions: [
      {
        condition: "Outside the bounds",
        status: "fail",
        prompt:
          "Too few issues is not a diagnosis, and too many is not a ranking. List them inside the bounds and rank them by impact.",
      },
      {
        condition: "Listed but not ranked",
        status: "warn",
        prompt:
          "The issues are listed but not ranked by impact. Ranking is what turns a list into a decision about what to leave out.",
      },
      {
        condition: "Listed and ranked",
        status: "pass",
        prompt:
          "Ranked by impact, so the priorities have somewhere to come from.",
      },
    ],
  },
  {
    id: "CY-4",
    group: "cycle",
    title: "Priorities set",
    feedsStrengthScore: false,
    conditions: [
      {
        condition: "Outside the bounds",
        status: "fail",
        prompt:
          "The priority count is outside what a cycle can carry. Cut to the number that fits, because the ones you drop here are the ones you would have dropped in month two anyway.",
      },
      {
        condition: "A priority with no twelve-month success statement",
        status: "fail",
        prompt:
          "Every priority needs a stated twelve-month success. Without it, nobody can tell later whether it worked.",
      },
      {
        condition: "In range, each with a success statement",
        status: "pass",
        prompt: "Each priority says what success looks like in twelve months.",
      },
    ],
  },
  {
    id: "CY-5",
    group: "cycle",
    title: "Not-doing list",
    feedsStrengthScore: false,
    conditions: [
      {
        condition: "Not written",
        status: "fail",
        prompt:
          "The not-doing list is empty. A plan that drops nothing is a wish list, and naming what you will not do is what makes the rest fit.",
      },
      {
        condition: "Written",
        status: "pass",
        prompt:
          "The not-doing list is written, so the focus is a choice rather than an intention.",
      },
    ],
  },
  {
    id: "CY-6",
    group: "cycle",
    title: "Capacity checked",
    feedsStrengthScore: false,
    conditions: [
      {
        condition: "Unchecked, or something still exceeds",
        status: "fail",
        prompt:
          "Capacity is not settled. Check it and record the cuts, because a key result still marked as exceeding capacity has already told you how the cycle ends.",
      },
      {
        condition: "Checked and nothing exceeds",
        status: "pass",
        prompt: "Capacity is checked and nothing is left exceeding it.",
      },
    ],
  },
  {
    id: "CY-7",
    group: "cycle",
    title: "Dependencies confirmed",
    feedsStrengthScore: false,
    conditions: [
      {
        condition: "A dependency neither confirmed nor risk-owned",
        status: "fail",
        prompt:
          "A dependency is neither confirmed by the team providing it nor logged as a risk with a named owner. One or the other, before this cycle starts.",
      },
      {
        condition: "Every dependency confirmed or risk-owned",
        status: "pass",
        prompt: "Every dependency is confirmed or owned as a risk.",
      },
    ],
  },
  {
    id: "CY-8",
    group: "cycle",
    title: "Sessions booked",
    feedsStrengthScore: false,
    conditions: [
      {
        condition: "Not booked for the whole cycle",
        status: "fail",
        prompt:
          "Book every check-in and review now, for the whole cycle. A cadence booked week by week is the one that quietly stops.",
      },
      {
        condition: "Booked for the whole cycle",
        status: "pass",
        prompt:
          "The whole cadence is in the calendar rather than in somebody's intention.",
      },
    ],
  },
];

export interface CycleCheckInput {
  /** Straight from `publishGates`. CY-6 is gate 5 and CY-7 is gate 4. */
  readonly gates: readonly {
    readonly gateKey: number;
    readonly passed: boolean;
  }[];
  readonly packComplete: boolean;
  /** Null when the pack has not been distributed, or no session is booked. */
  readonly packLeadWorkingDays: number | null;
  readonly priorCycleScored: boolean;
  readonly firstCycle: boolean;
  readonly issueCount: number;
  readonly issuesRanked: boolean;
  readonly priorityCount: number;
  readonly prioritiesWithSuccess: number;
  readonly notDoingWritten: boolean;
  /** Undefined until P4-T04 ships sessions. `todo` rather than a guess. */
  readonly sessionsBookedForWholeCycle?: boolean;
}

/**
 * §4.4 as verdicts.
 *
 * Everything numeric comes from the §11 registry, so a workspace that widens
 * its issue bounds widens this check with it rather than being told one thing
 * by the cycle rail and another by the coach.
 */
export function evaluateCycle(
  input: CycleCheckInput,
  thresholds: ResolvedThresholds,
): readonly QualityVerdict[] {
  const lead = thresholds["quality.inputPackLeadWorkingDays"];
  const issues = thresholds["quality.strategicIssueBounds"];
  const priorities = thresholds["quality.priorityBounds"];
  const gate = (key: number) =>
    input.gates.find((entry) => entry.gateKey === key);

  const cy1 =
    input.packComplete &&
    input.packLeadWorkingDays !== null &&
    input.packLeadWorkingDays >= lead
      ? "Complete and distributed in time"
      : "Items missing, or distributed too late";

  const cy2 =
    input.priorCycleScored || input.firstCycle
      ? "Scored, or declared the first cycle"
      : "Neither scored nor declared a first cycle";

  const cy3 =
    input.issueCount < issues.low || input.issueCount > issues.high
      ? "Outside the bounds"
      : input.issuesRanked
        ? "Listed and ranked"
        : "Listed but not ranked";

  const cy4 =
    input.priorityCount < priorities.low ||
    input.priorityCount > priorities.high
      ? "Outside the bounds"
      : input.prioritiesWithSuccess < input.priorityCount
        ? "A priority with no twelve-month success statement"
        : "In range, each with a success statement";

  const cy5 = input.notDoingWritten ? "Written" : "Not written";

  const cy6 = gate(5)?.passed
    ? "Checked and nothing exceeds"
    : "Unchecked, or something still exceeds";

  const cy7 = gate(4)?.passed
    ? "Every dependency confirmed or risk-owned"
    : "A dependency neither confirmed nor risk-owned";

  const verdicts: QualityVerdict[] = [
    verdictOf(check("CY-1"), cy1),
    verdictOf(check("CY-2"), cy2),
    verdictOf(check("CY-3"), cy3),
    verdictOf(check("CY-4"), cy4),
    verdictOf(check("CY-5"), cy5),
    verdictOf(check("CY-6"), cy6),
    verdictOf(check("CY-7"), cy7),
  ];

  const cy8 = check("CY-8");
  verdicts.push(
    input.sessionsBookedForWholeCycle === undefined
      ? {
          id: cy8.id,
          status: "todo",
          prompt:
            "Nothing books sessions yet, so whether the cadence is in the calendar cannot be read. P4-T04 brings it.",
          feedsStrengthScore: false,
        }
      : verdictOf(
          cy8,
          input.sessionsBookedForWholeCycle
            ? "Booked for the whole cycle"
            : "Not booked for the whole cycle",
        ),
  );

  return verdicts;
}

/**
 * METHOD.md §4.6's weak and strong pairs.
 *
 * The coach shows these beside the check that fired, which is why each pair
 * names its checks rather than sitting in a list of general advice. A prompt
 * tells somebody what is wrong; the pair shows them what right looks like on
 * the same sentence, and that is a different kind of help.
 *
 * The second pair fires two checks, so `firesChecks` is a list. Nothing here
 * is paraphrased: weak, strong and why are METHOD.md's own words.
 */
export interface QualityExample {
  readonly weak: string;
  readonly strong: string;
  readonly why: string;
  /** The checks the weak version trips, by id. */
  readonly firesChecks: readonly string[];
}

export const QUALITY_EXAMPLES: readonly QualityExample[] = [
  {
    weak: "Objective: Launch the new mobile app by end of Q3",
    strong: "Objective: Make mobile the way our customers prefer to reach us",
    why: "Launch is an output. You can launch and still fail. The strong version names the change in customer behaviour, and the launch becomes a means",
    firesChecks: ["OBJ-1"],
  },
  {
    weak: "KR: Improve customer satisfaction",
    strong:
      "KR: Increase NPS from 32 to 50 (lagging). KR: Cut first-response time from 9h to 2h (leading)",
    why: "No baseline, no target, no way to score it. The strong pair sets from and to, and combines lagging proof with a leading signal you can steer weekly",
    firesChecks: ["KR-2", "KR-4"],
  },
  {
    weak: "KR: Hold 12 customer interviews",
    strong: "KR: Raise activation rate of new sign-ups from 41% to 60%",
    why: "Interviews are activity. Ask what the interviews are for, and measure that outcome",
    firesChecks: ["KR-5"],
  },
  {
    weak: "KR: Increase sales calls from 40 to 120 per week",
    strong:
      "KR: Grow qualified pipeline from $1.2M to $3.0M (lagging). KR: Lift call-to-meeting conversion from 8% to 15% (leading)",
    why: "Measurable, but still an output. If 120 calls create no pipeline, the key result was achieved and the quarter was wasted",
    firesChecks: ["KR-5"],
  },
];

/**
 * The pairs to show beside one check's verdict.
 *
 * Empty for most checks, and that is correct rather than a gap: §4.6 carries
 * four pairs, not twenty-six. A rule card with no example shows its prompt and
 * says nothing more.
 */
export function examplesFor(checkId: string): readonly QualityExample[] {
  return QUALITY_EXAMPLES.filter((entry) =>
    entry.firesChecks.includes(checkId),
  );
}
