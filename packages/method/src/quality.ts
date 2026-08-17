import type { ResolvedThresholds } from "./thresholds.ts";

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
  const found = OBJECTIVE_CHECKS.find((entry) => entry.id === id);
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

  // OBJ-2
  const obj2 = check("OBJ-2");
  const obj2Verdict = hasDigits
    ? verdictOf(obj2, "Contains digits")
    : wordCount < 4
      ? verdictOf(obj2, "Fewer than 4 words")
      : wordCount > 18
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
