/**
 * The method's terms, as holes in the message catalogue (completeness review
 * M-14, TECHNICAL-PLAN §4.14 "terminology labels").
 *
 * **A workspace could rename a term and nothing on screen changed.** The
 * rhythm card saved `rhythm_settings.labels` and `packages/method` resolved
 * them, and every screen still said "Objective", because the word was written
 * into the catalogue string itself.
 *
 * **A term is a named hole, not a word to search for.** A message that names a
 * term says so, `"Add {termObjectiveLower}"`, and `translate` fills it. Nothing
 * rewrites catalogue text by looking for the English word, which would also
 * rewrite "objectively" and every coaching sentence that quotes the method.
 *
 * Four holes per term, because a sentence needs the word in two numbers and in
 * two places:
 *
 * | Hole | English, not renamed | Use |
 * |---|---|---|
 * | `{termObjective}` | Objective | A heading, a label, the start of a sentence |
 * | `{termObjectives}` | Objectives | The same, plural |
 * | `{termObjectiveLower}` | objective | Inside a sentence |
 * | `{termObjectivesLower}` | objectives | The same, plural |
 *
 * **What fills a hole.** The workspace's own label when it renamed the term,
 * otherwise the catalogue's own word for it in the reader's language
 * (`term.objective.singular` is "Objective" in English and "Objektif" in Bahasa
 * Melayu). A rename is one pair of words an administrator typed, and the
 * settings hold no second language for it, so it is shown in every language:
 * it is the organisation's own word for the thing, not a translation of ours.
 *
 * **No indefinite article.** "a" or "an" depends on how the word sounds, which
 * nothing here can know about a word an administrator typed, so a message that
 * holds a term never puts one in front of it. "Create the {termSpaceLower}"
 * and "New {termSpaceLower}" work for any word; "Create a {termSpaceLower}"
 * would read "Create a area".
 *
 * Rules and coaching messages keep the method's own words: a label is
 * presentation, and METHOD.md is not relabelled.
 */
import {
  TERM_KEYS,
  TERMINOLOGY,
  type TerminologyOverrides,
  type TermKey,
  validateTerminology,
} from "@openokr/method";

type TermNumber = "singular" | "plural";

type TermPosition = "start" | "running";

interface TermHole {
  readonly term: TermKey;
  readonly number: TermNumber;
  readonly position: TermPosition;
}

/**
 * Where each term's own word lives, per language.
 *
 * Written out rather than built from the key, so the catalogue's
 * every-key-has-a-consumer check finds each one read here.
 */
const TERM_CATALOGUE_KEYS: Readonly<
  Record<TermKey, Readonly<Record<TermNumber, string>>>
> = {
  objective: {
    singular: "term.objective.singular",
    plural: "term.objective.plural",
  },
  keyResult: {
    singular: "term.keyResult.singular",
    plural: "term.keyResult.plural",
  },
  cycle: { singular: "term.cycle.singular", plural: "term.cycle.plural" },
  space: { singular: "term.space.singular", plural: "term.space.plural" },
  champion: {
    singular: "term.champion.singular",
    plural: "term.champion.plural",
  },
  reviewer: {
    singular: "term.reviewer.singular",
    plural: "term.reviewer.plural",
  },
  sponsor: { singular: "term.sponsor.singular", plural: "term.sponsor.plural" },
  facilitator: {
    singular: "term.facilitator.singular",
    plural: "term.facilitator.plural",
  },
  coordinator: {
    singular: "term.coordinator.singular",
    plural: "term.coordinator.plural",
  },
  contributor: {
    singular: "term.contributor.singular",
    plural: "term.contributor.plural",
  },
  checkIn: { singular: "term.checkIn.singular", plural: "term.checkIn.plural" },
  confidence: {
    singular: "term.confidence.singular",
    plural: "term.confidence.plural",
  },
  score: { singular: "term.score.singular", plural: "term.score.plural" },
  kpi: { singular: "term.kpi.singular", plural: "term.kpi.plural" },
  atRisk: {
    singular: "term.atRisk.singular",
    plural: "term.atRisk.plural",
  },
};

/**
 * How a hole's name marks its number and its place. A hole name is an
 * identifier, not English: the plural hole of every term ends in the same
 * letter whatever the word it is filled with does.
 */
const NUMBER_MARK: Readonly<Record<TermNumber, string>> = {
  singular: "",
  plural: "s",
};
const POSITION_MARK: Readonly<Record<TermPosition, string>> = {
  start: "",
  running: "Lower",
};

/** The name of one term hole, the way a catalogue string spells it. */
export function termHoleName(
  term: TermKey,
  number: TermNumber,
  position: TermPosition,
): string {
  const stem = `term${term.charAt(0).toUpperCase()}${term.slice(1)}`;
  return `${stem}${NUMBER_MARK[number]}${POSITION_MARK[position]}`;
}

const TERM_HOLES: ReadonlyMap<string, TermHole> = new Map(
  TERM_KEYS.flatMap((term) =>
    (["singular", "plural"] as const).flatMap((number) =>
      (["start", "running"] as const).map(
        (position) =>
          [
            termHoleName(term, number, position),
            { term, number, position },
          ] as const,
      ),
    ),
  ),
);

export function isTermHole(name: string): boolean {
  return TERM_HOLES.has(name);
}

/**
 * The word where a sentence starts or a heading stands alone.
 *
 * Only the first letter is raised, so "big rock" heads a card as "Big rock"
 * and "KPI" stays "KPI".
 */
function atSentenceStart(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The word inside a sentence: "Add key result", not "Add Key result".
 *
 * Each word is lowered only when its first letter is the only capital in it,
 * which is what a capital put there by sentence case looks like. "KPI", "OKR"
 * and "iOS" keep their capitals, so an acronym is never written "kPI".
 */
export function inRunningText(label: string): string {
  return label
    .split(" ")
    .map((word) => {
      const first = word.charAt(0);
      const rest = word.slice(1);
      const capitalisedBySentenceCase =
        first !== first.toLowerCase() && rest === rest.toLowerCase();
      return capitalisedBySentenceCase ? first.toLowerCase() + rest : word;
    })
    .join(" ");
}

/**
 * What one term hole says, for this catalogue and this workspace.
 *
 * Returns undefined for a name that is not a term hole, so the caller can
 * treat it as an ordinary value.
 */
export function fillTermHole(
  catalogue: Readonly<Record<string, string>>,
  name: string,
  renamed?: TerminologyOverrides,
): string | undefined {
  const hole = TERM_HOLES.get(name);
  if (!hole) {
    return undefined;
  }
  const key = TERM_CATALOGUE_KEYS[hole.term][hole.number];
  const label = renamed?.[hole.term]?.[hole.number] ?? catalogue[key];
  if (label === undefined) {
    // The same rule as a missing message: a hole rendered as "{termCycle}"
    // is the defect the catalogue refuses to fabricate a fallback for.
    throw new Error(`No catalogue entry for "${key}".`);
  }
  return hole.position === "start"
    ? atSentenceStart(label)
    : inRunningText(label);
}

/**
 * The terms a workspace has renamed, from the resolved map `rhythm.read`
 * returns.
 *
 * The resolved map carries every term, with the English canon for the ones
 * nobody renamed. Those are dropped here, because a term nobody renamed must
 * read in the reader's own language rather than in English. `rhythm.update`
 * already refuses to store a label equal to the canon, so equal means not
 * renamed.
 */
export function renamedTerms(resolved: unknown): TerminologyOverrides {
  if (resolved === null || typeof resolved !== "object") {
    return {};
  }
  const { labels } = validateTerminology(resolved);
  const renamed: Partial<
    Record<TermKey, { singular: string; plural: string }>
  > = {};
  for (const term of TERM_KEYS) {
    const label = labels[term];
    const canon = TERMINOLOGY[term];
    if (
      label !== undefined &&
      (label.singular !== canon.singular || label.plural !== canon.plural)
    ) {
      renamed[term] = label;
    }
  }
  return renamed;
}
