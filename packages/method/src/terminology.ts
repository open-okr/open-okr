/**
 * Terminology labels (TECHNICAL-PLAN §4.14, METHOD.md §11).
 *
 * §11's defaults table says a workspace starts with "the canon terms in the
 * workspace default language". Some organisations call an objective an ambition
 * and a champion an owner, and refusing them the word costs adoption for no
 * methodological gain. What a term *means* is canon; what it is *called* is not.
 *
 * The key set is fixed, which is the whole point: a workspace renames a concept
 * the method already has, and cannot invent one. A label is presentation, so
 * nothing in `packages/method`, `packages/core` or any engine reads these
 * values to make a decision.
 *
 * Pure data plus a resolver, like the threshold registry beside it.
 */
import { z } from "zod";

export interface TermDefinition {
  /** The canon word, from METHOD.md's own vocabulary table. */
  readonly singular: string;
  readonly plural: string;
  /** What the concept is, so a renaming admin knows what they are renaming. */
  readonly meaning: string;
  /**
   * A common alternative the terminology card offers, where METHOD.md names
   * one (P9-T21, decision D6). Offered, never applied.
   */
  readonly suggested?: { readonly singular: string; readonly plural: string };
}

/**
 * Every renameable term. Keys are stable and never change once shipped: they
 * are what a workspace's label map is keyed by.
 */
export const TERMINOLOGY = {
  objective: {
    singular: "Objective",
    plural: "Objectives",
    meaning:
      "A statement of a desired future state. Usually qualitative and memorable. Also called a goal in the product.",
  },
  keyResult: {
    singular: "Key result",
    plural: "Key results",
    meaning:
      "A verifiable result that proves the objective is being achieved. Usually a measured change from a baseline to a target by a date; also a value held inside a band, a milestone done or not done, or a baseline still to be established.",
  },
  cycle: {
    singular: "Cycle",
    plural: "Cycles",
    meaning: "The time box the OKRs are set and scored against.",
  },
  space: {
    singular: "Space",
    plural: "Spaces",
    meaning:
      "A team home: the unit that owns goals and holds a weekly session.",
  },
  champion: {
    singular: "Champion",
    plural: "Champions",
    meaning:
      "The one person accountable for a goal. They post the check-in. Never a team, never a committee.",
    // METHOD.md's terms: "'Owner' is a common alternative" (decision D6).
    suggested: { singular: "Owner", plural: "Owners" },
  },
  reviewer: {
    singular: "Reviewer",
    plural: "Reviewers",
    meaning:
      "The person who acknowledges a goal's check-ins, where the workspace uses reviewers.",
  },
  sponsor: {
    singular: "Sponsor",
    plural: "Sponsors",
    meaning: "The senior leader accountable for the whole cycle.",
  },
  facilitator: {
    singular: "Facilitator",
    plural: "Facilitators",
    meaning: "The person who runs the sessions and guards the quality bar.",
  },
  coordinator: {
    singular: "Coordinator",
    plural: "Coordinators",
    meaning:
      "Runs the weekly session for a space and chases blockers. One per space.",
  },
  contributor: {
    singular: "Contributor",
    plural: "Contributors",
    meaning: "Anyone doing work that moves a key result.",
  },
  checkIn: {
    singular: "Check-in",
    plural: "Check-ins",
    meaning:
      "A short written update on a goal, with a snapshot of every key result value at that moment.",
  },
  confidence: {
    singular: "Confidence",
    plural: "Confidence",
    meaning:
      'A belief that a key result will land, forward-looking. Stored 0.0 to 1.0 and shown as "x in 10" by default.',
  },
  score: {
    singular: "Score",
    plural: "Scores",
    meaning:
      "A 0.0 to 1.0 measure of what actually happened, judged at the close. Backward-looking.",
  },
  kpi: {
    singular: "KPI",
    plural: "KPIs",
    meaning:
      "A number you watch every period whether or not it is an OKR. KPIs describe the health of the business.",
  },
  // METHOD.md §3.5 (P9-T15b-a): "At risk" is the default label for the
  // stored check-in status `caution`, set here so a workspace can say it its
  // own way, as it can every other term.
  atRisk: {
    singular: "At risk",
    plural: "At risk",
    meaning:
      "The label for a check-in status of caution: the work may miss unless something changes.",
  },
} as const satisfies Record<string, TermDefinition>;

export type TermKey = keyof typeof TERMINOLOGY;

export const TERM_KEYS = Object.keys(TERMINOLOGY) as TermKey[];

export function isTermKey(key: string): key is TermKey {
  return Object.hasOwn(TERMINOLOGY, key);
}

/** The alternative METHOD.md names for a term, where it names one (D6). */
export function suggestedTerm(
  key: TermKey,
): TermDefinition["suggested"] | undefined {
  const definition: TermDefinition = TERMINOLOGY[key];
  return definition.suggested;
}

/** One renamed term. Both forms are required: a plural nobody set reads wrong. */
export const termLabelSchema = z.object({
  singular: z.string().trim().min(1).max(40),
  plural: z.string().trim().min(1).max(40),
});

export type TermLabel = z.infer<typeof termLabelSchema>;

/** A workspace's deviations. Sparse: an absent key reads the canon term. */
export type TerminologyOverrides = { readonly [K in TermKey]?: TermLabel };

export type ResolvedTerminology = { readonly [K in TermKey]: TermLabel };

export interface TerminologyProblem {
  readonly key: string;
  readonly message: string;
}

export interface TerminologyValidation {
  readonly labels: TerminologyOverrides;
  readonly problems: readonly TerminologyProblem[];
}

/** Validates a submitted label map. Reports every problem, never throws. */
export function validateTerminology(input: unknown): TerminologyValidation {
  const problems: TerminologyProblem[] = [];
  const labels: Record<string, TermLabel> = {};

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      labels: {},
      problems: [
        { key: "", message: "Labels must be an object keyed by term." },
      ],
    };
  }

  for (const [key, value] of Object.entries(input)) {
    if (!isTermKey(key)) {
      problems.push({
        key,
        message: `"${key}" is not a term the method defines, so it cannot be renamed.`,
      });
      continue;
    }
    const parsed = termLabelSchema.safeParse(value);
    if (!parsed.success) {
      problems.push({
        key,
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
      continue;
    }
    labels[key] = parsed.data;
  }

  return { labels, problems };
}

/** The canon terms with a workspace's renames applied. */
export function resolveTerminology(
  overrides?: TerminologyOverrides | unknown,
): ResolvedTerminology {
  const resolved: Record<string, TermLabel> = {};
  for (const key of TERM_KEYS) {
    const canon = TERMINOLOGY[key];
    resolved[key] = { singular: canon.singular, plural: canon.plural };
  }
  if (overrides === undefined || overrides === null) {
    return resolved as ResolvedTerminology;
  }
  const { labels } = validateTerminology(overrides);
  for (const [key, label] of Object.entries(labels)) {
    resolved[key] = label;
  }
  return resolved as ResolvedTerminology;
}
