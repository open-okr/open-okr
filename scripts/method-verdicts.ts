/**
 * Twenty real OKR drafts, and the verdicts this product gives them
 * (P7-T07).
 *
 * **This exists to be read by a person, and that is the whole point.** The
 * conformance suite proves the package agrees with the document. It cannot
 * prove the document is right, and P7-T07's acceptance criterion is a human
 * confirming that twenty real drafts receive verdicts they agree with. So
 * this prints them, with the rule that fired and what it said.
 *
 * The drafts are not invented to trip the checks. They are the shapes real
 * teams write: activity disguised as an outcome, a number in the objective
 * title, a key result nobody owns, a set of eleven, a moonshot with no path.
 * A draft that exists only to fire one rule proves the rule runs, which the
 * unit suite already does.
 *
 * Usage: pnpm method:verdicts
 *
 * Read the output against METHOD.md section 4. A verdict you disagree with
 * is a finding: either the word list, the threshold or the rule is wrong,
 * and all three are a human's decision under CLAUDE.md.
 */
import {
  canonThresholds,
  evaluateKeyResults,
  evaluateObjective,
} from "../packages/method/src/index.ts";

const NEWLINE = String.fromCharCode(10);
const thresholds = canonThresholds();

interface Draft {
  readonly n: number;
  /** What a real team was trying to do, in one line. */
  readonly context: string;
  readonly objective: string;
  readonly keyResults: readonly string[];
  /** Set when the draft is deliberately missing something. */
  readonly missing?: {
    readonly champion?: true;
    readonly reviewer?: true;
    readonly timeframe?: true;
  };
  readonly objectivesInUnit?: number;
  readonly level?: "company" | "department" | "team" | "individual";
}

const DRAFTS: readonly Draft[] = [
  {
    n: 1,
    context: "A product team with a clear outcome. Should pass clean.",
    objective: "Make onboarding something new customers finish by themselves",
    keyResults: [
      "Raise trial-to-paid conversion from 11% to 18%",
      "Cut median time to first value from 6 days to 2 days",
      "Reduce onboarding support tickets per 100 signups from 24 to 10",
    ],
  },
  {
    n: 2,
    context: "Activity written as an outcome. The commonest real mistake.",
    objective: "Launch the new mobile app by end of Q3",
    keyResults: [
      "Ship the iOS build to the App Store",
      "Complete the Android beta programme",
      "Deliver the marketing site refresh",
    ],
  },
  {
    n: 3,
    context: "A target buried in the objective title.",
    objective: "Grow revenue 40% this quarter",
    keyResults: [
      "Increase new business bookings from 1.2M to 1.7M",
      "Lift net revenue retention from 104% to 112%",
    ],
  },
  {
    n: 4,
    context: "Eleven key results on one objective. A real quarterly plan.",
    objective: "Become the team engineering trusts to ship safely",
    keyResults: [
      "Cut change failure rate from 18% to 8%",
      "Reduce median lead time from 9 days to 3 days",
      "Raise deployment frequency from weekly to daily",
      "Cut mean time to restore from 4 hours to 45 minutes",
      "Raise test coverage on the payments path from 54% to 85%",
      "Reduce flaky test rate from 6% to 1%",
      "Cut p95 build time from 22 minutes to 8 minutes",
      "Reduce open critical vulnerabilities from 7 to 0",
      "Raise on-call satisfaction from 2.8 to 4.0 out of 5",
      "Cut unplanned work from 40% to 20% of sprint capacity",
      "Reduce rollback count from 11 to 2 per quarter",
    ],
  },
  {
    n: 5,
    context: "Nobody owns it. A draft that got as far as a title.",
    objective: "Win back the customers we lost last year",
    keyResults: ["Reduce logo churn from 14% to 7%"],
    missing: { champion: true, reviewer: true },
  },
  {
    n: 6,
    context: "A single key result. Common, and not always wrong.",
    objective: "Make our pricing something a buyer can understand unaided",
    keyResults: [
      "Raise the share of self-serve purchases completed without contacting sales from 31% to 60%",
    ],
  },
  {
    n: 7,
    context: "Every key result is a milestone. The plan-in-disguise shape.",
    objective: "Modernise the data platform",
    keyResults: [
      "Migrate the warehouse to the new cluster",
      "Implement the streaming ingestion pipeline",
      "Create the semantic layer",
      "Build the self-serve dashboard library",
    ],
  },
  {
    n: 8,
    context: "Vague verb, no baseline. Reads confident, measures nothing.",
    objective: "Improve customer satisfaction significantly",
    keyResults: [
      "Improve NPS",
      "Better support response times",
      "More positive reviews",
    ],
  },
  {
    n: 9,
    context: "A company-level objective with no timeframe set.",
    objective: "Reach the point where the product sells itself",
    keyResults: [
      "Raise the share of new revenue from referral and word of mouth from 8% to 25%",
      "Lift the free-to-paid rate from 3.1% to 6%",
    ],
    level: "company",
    missing: { timeframe: true },
  },
  {
    n: 10,
    context: "Two of the three key results measure the same thing.",
    objective: "Make the support queue something the team can keep on top of",
    keyResults: [
      "Cut median first response time from 9 hours to 2 hours",
      "Reduce average first response time from 11 hours to 3 hours",
      "Raise one-touch resolution from 38% to 55%",
    ],
  },
  {
    n: 11,
    context: "Good objective, key results written as percentages of a plan.",
    objective: "Give finance a close they can trust without a manual check",
    keyResults: [
      "Complete 100% of the reconciliation automation",
      "Achieve 90% of the planned control migrations",
    ],
  },
  {
    n: 12,
    context: "A moonshot. Real, and worth a warning rather than a refusal.",
    objective: "Take the category lead from the incumbent",
    keyResults: [
      "Raise market share from 4% to 20%",
      "Grow enterprise logos from 6 to 60",
    ],
  },
  {
    n: 13,
    context: "An individual objective that is really a job description.",
    objective: "Be a strong technical lead for the payments team",
    keyResults: [
      "Hold weekly one-to-ones with all six engineers",
      "Attend the architecture forum every fortnight",
    ],
    level: "individual",
  },
  {
    n: 14,
    context: "Correct shape, but the objective hedges.",
    objective: "Try to reduce the cost of serving our largest accounts",
    keyResults: [
      "Cut infrastructure cost per enterprise account from 1,900 to 1,200 a month",
      "Reduce support hours per enterprise account from 14 to 8 a month",
    ],
  },
  {
    n: 15,
    context: "Nine objectives in one unit. Focus is the failure here.",
    objective: "Make the checkout something nobody abandons",
    keyResults: [
      "Cut cart abandonment from 71% to 58%",
      "Raise payment success rate from 94.2% to 98%",
    ],
    objectivesInUnit: 9,
  },
  {
    n: 16,
    context: "An objective naming a tool rather than an outcome.",
    objective: "Roll out Salesforce across the revenue org",
    keyResults: [
      "Raise the share of pipeline with complete stage data from 46% to 95%",
      "Cut the time to produce a board forecast from 5 days to 4 hours",
    ],
  },
  {
    n: 17,
    context: "Outcome objective, key results with baselines and directions.",
    objective: "Make the platform something an auditor can verify unaided",
    keyResults: [
      "Raise the share of privileged actions with a verifiable audit row from 82% to 100%",
      "Cut the time to produce a full access review from 3 weeks to 2 days",
    ],
  },
  {
    n: 18,
    context: "A key result that is really two.",
    objective: "Make hiring something candidates recommend to their friends",
    keyResults: [
      "Cut time to offer from 38 days to 21 days and raise offer acceptance from 62% to 80%",
      "Raise candidate experience score from 3.9 to 4.5 out of 5",
    ],
  },
  {
    n: 19,
    context: "Department objective that restates the company one.",
    objective: "Support the company goal of growing revenue",
    keyResults: [
      "Increase marketing-sourced pipeline from 4.1M to 7M",
      "Raise the pipeline-to-close rate from 19% to 26%",
    ],
    level: "department",
  },
  {
    n: 20,
    context: "Clean set on a hard problem. Should pass with nothing to say.",
    objective: "Make a failed payment something a customer never has to chase",
    keyResults: [
      "Raise automatic dunning recovery from 31% to 58%",
      "Cut involuntary churn from 2.4% to 0.9% a month",
      "Reduce payment-related contacts per 1,000 customers from 19 to 6",
    ],
  },
];

const STATUS_MARK: Readonly<Record<string, string>> = {
  pass: "pass",
  warn: "WARN",
  fail: "FAIL",
  todo: "todo",
};

/**
 * Reads a baseline, a target and a direction out of the sentence.
 *
 * **This parser is in the harness and deliberately not in the product**, and
 * that gap is the finding this script exists to show. The quality engine
 * reads `baselineValue`, `targetValue`, `direction` and `indicatorType` from
 * the key result's own columns, which a member fills in by hand. With the AI
 * provider off there is nothing that offers them from what the member has
 * already typed, so "Raise trial-to-paid conversion from 11% to 18%" scores
 * three refusals for three facts its own sentence states.
 *
 * So the run below prints both moments: the sentence alone, which is what a
 * member sees while typing, and the sentence with what it plainly says filled
 * in, which is what a finished key result looks like. The difference between
 * the two counts is the false-positive picture P7-T07 asks a human to judge.
 */
// A unit may sit between the number and `to`: "from 6 days to 2 days",
// "from 1,900 to 1,200 a month", "from 2.8 to 4.0 out of 5".
const RANGE = /\bfrom\s+([\d.,]+)\s*%?\s*[a-z%]*\s+to\s+([\d.,]+)/i;
const RAISE_WORDS = /\b(raise|increase|lift|grow|improve|more)\b/i;
const REDUCE_WORDS = /\b(cut|reduce|lower|decrease|fewer|less)\b/i;

function asKeyResult(text: string, filled: boolean) {
  if (!filled) {
    return {
      text,
      baseline: null,
      target: null,
      dueOn: null,
      ownerId: "member-1",
      indicatorType: null,
      direction: null,
      confidence: null,
    };
  }
  const range = RANGE.exec(text);
  const baseline = range ? Number(range[1]?.replace(/,/g, "")) : null;
  const target = range ? Number(range[2]?.replace(/,/g, "")) : null;
  const direction = REDUCE_WORDS.test(text)
    ? ("reduce" as const)
    : RAISE_WORDS.test(text)
      ? ("increase" as const)
      : null;
  return {
    text,
    baseline: Number.isFinite(baseline) ? baseline : null,
    target: Number.isFinite(target) ? target : null,
    dueOn: "2026-12-31",
    ownerId: "member-1",
    // Whether a measure is leading or lagging is a judgement about the
    // business, not something a sentence states, so a filled-in draft is
    // given the one a reader would pick rather than left null.
    indicatorType: "lagging" as const,
    direction,
    confidence: 0.6,
  };
}

let warned = 0;
let refused = 0;
let clean = 0;
let warnedAsTyped = 0;
let refusedAsTyped = 0;
let cleanAsTyped = 0;

const lines: string[] = [];
const filled = true;

for (const draft of DRAFTS) {
  // The same draft as a member first types it: the sentence and nothing else.
  const asTyped = [
    ...evaluateObjective(
      {
        title: draft.objective,
        hasCycle: true,
        hasTimeframe: draft.missing?.timeframe !== true,
        championId: draft.missing?.champion === true ? null : "member-1",
        reviewerId: draft.missing?.reviewer === true ? null : "member-2",
        objectivesInUnit: draft.objectivesInUnit ?? 3,
        level: draft.level ?? "team",
      },
      thresholds,
    ),
    ...evaluateKeyResults(
      { keyResults: draft.keyResults.map((text) => asKeyResult(text, false)) },
      thresholds,
    ),
  ].filter((verdict) => verdict.status !== "pass");
  if (asTyped.length === 0) {
    cleanAsTyped += 1;
  }
  warnedAsTyped += asTyped.filter((v) => v.status === "warn").length;
  refusedAsTyped += asTyped.filter((v) => v.status === "fail").length;

  const objectiveVerdicts = evaluateObjective(
    {
      title: draft.objective,
      hasCycle: true,
      hasTimeframe: draft.missing?.timeframe !== true,
      championId: draft.missing?.champion === true ? null : "member-1",
      reviewerId: draft.missing?.reviewer === true ? null : "member-2",
      objectivesInUnit: draft.objectivesInUnit ?? 3,
      level: draft.level ?? "team",
    },
    thresholds,
  );

  const keyResultVerdicts = evaluateKeyResults(
    { keyResults: draft.keyResults.map((text) => asKeyResult(text, filled)) },
    thresholds,
  );

  const raised = [
    ...objectiveVerdicts.filter((verdict) => verdict.status !== "pass"),
    ...keyResultVerdicts.filter((verdict) => verdict.status !== "pass"),
  ];

  if (raised.length === 0) {
    clean += 1;
  }
  warned += raised.filter((verdict) => verdict.status === "warn").length;
  refused += raised.filter((verdict) => verdict.status === "fail").length;

  lines.push(`${NEWLINE}--- ${draft.n}. ${draft.context}`);
  lines.push(`    O:  ${draft.objective}`);
  for (const keyResult of draft.keyResults) {
    lines.push(`    KR: ${keyResult}`);
  }
  if (raised.length === 0) {
    lines.push("    nothing raised");
    continue;
  }
  const seen = new Set<string>();
  for (const verdict of raised) {
    // One line per rule rather than per key result. A set of eleven would
    // otherwise print the same prompt eleven times and bury everything else.
    const key = `${verdict.status}:${verdict.id}:${verdict.prompt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    lines.push(
      `    [${STATUS_MARK[verdict.status] ?? verdict.status}] ${verdict.id}: ${verdict.prompt}`,
    );
  }
}

console.log("Twenty real drafts through the quality canon, at two moments.");
console.log("");
console.log(
  `  as first typed, sentence only:  ${cleanAsTyped} clean, ` +
    `${warnedAsTyped} warning(s), ${refusedAsTyped} refusal(s)`,
);
console.log(
  `  with what the sentence states:  ${clean} clean, ` +
    `${warned} warning(s), ${refused} refusal(s)`,
);
console.log("");
console.log(
  "The gap between those two lines is the false-positive picture P7-T07 asks",
);
console.log(
  "a human to judge. The product has no deterministic parse of a baseline,",
);
console.log(
  "a target or a direction out of the member's own sentence, so with the AI",
);
console.log(
  "provider off every refusal in the first line that the second line clears",
);
console.log("is the coach asking for something already on the screen.");
console.log("");
console.log(
  "The verdicts below are the second moment: a finished key result. Read each",
);
console.log("against METHOD.md section 4. One you disagree with is a finding.");
console.log(lines.join(NEWLINE));
