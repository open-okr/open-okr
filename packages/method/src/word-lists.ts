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
