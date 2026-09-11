/**
 * The §4 word lists, which METHOD.md §11 carries as the `Quality word lists`
 * parameter: "The §4 lists. A workspace may add terms; the canon terms remain".
 *
 * They live in their own module so `thresholds.ts` can hold them as that
 * parameter's default without importing the evaluator that uses them. The
 * canon arrays are here; the resolver unions a workspace's additions on top,
 * because §11 says the canon terms remain rather than being replaced.
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
    // Added 2026-08-18 by human decision. §4.6 offers "Make mobile the way our
    // customers prefer to reach us" as its strong example, and without the verb
    // form OBJ-1 warned "Cannot tell" on the canon's own exemplar.
    "prefer",
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

/** The six canon lists, every one of them present. */
export type QualityWordLists = {
  readonly [K in keyof typeof QUALITY_WORD_LISTS]: readonly string[];
};

/**
 * The lists a check should use, canon filled in behind whatever the registry
 * resolved.
 *
 * The resolver already unions a workspace's additions onto the canon, so this
 * is belt and braces rather than the merge itself. It exists so the type is
 * total: a check reading `lists.activityNouns` gets an array, never undefined,
 * and cannot be written to handle a missing list that cannot happen.
 */
export function wordListsFrom(
  resolved: Record<string, readonly string[]>,
): QualityWordLists {
  return { ...QUALITY_WORD_LISTS, ...resolved } as QualityWordLists;
}

/**
 * §4.1's end-state shapes, which OBJ-1 passes on (P7-T07a).
 *
 * **A word list can only recognise an end state that happens to use one of
 * its words.** The P7-T07 audit measured OBJ-1 against twenty real drafts:
 * sixteen warned, and the warning was the "Cannot tell" fallback rather than
 * a real objection. They were well-formed outcomes that used none of the
 * twenty-two state words, because English has more ways of naming a state
 * than any list will hold. A check firing on nineteen objectives out of
 * twenty is a banner rather than coaching.
 *
 * So these are shapes, not vocabulary. Each is a sequence of literal words
 * with `…` standing for any words between them, and an objective matching
 * one names an end state whatever nouns it uses.
 *
 * Deliberately short and deliberately evidenced. Every shape here appeared in
 * the audit's own drafts; none was invented to look thorough. Adding one is a
 * METHOD.md change like any other, and the conformance suite compares this
 * list against §4.1 in both directions.
 */
export const END_STATE_SHAPES: readonly string[] = [
  "make … something …",
  "reach the point where …",
  "get to where …",
];

/**
 * Whether a title matches one of the shapes above.
 *
 * The gap stands for at least one word, not for nothing: "make something" is
 * not an end state, and a shape that matched it would pass an objective that
 * names neither a subject nor a property.
 */
export function matchesEndStateShape(
  title: string,
  shapes: readonly string[] = END_STATE_SHAPES,
): boolean {
  const lower = title.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  return shapes.some((shape) => {
    const parts = shape
      .split("…")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    if (parts.length === 0) {
      return false;
    }
    const pattern = parts
      .map((part) => part.split(/\s+/).map(escapeForPattern).join("\\s+"))
      .join("\\s+\\S+(?:\\s+\\S+)*\\s+");
    // Anchored at the start, open at the end. Every shape here opens a
    // sentence; a shape found in the middle of one is a coincidence rather
    // than a form.
    return new RegExp(`^\\s*${pattern}\\s+\\S+`, "i").test(lower);
  });
}

const escapeForPattern = (word: string): string =>
  word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
