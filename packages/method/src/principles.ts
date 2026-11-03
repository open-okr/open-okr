/**
 * METHOD.md §1's operating principles, by number and title.
 *
 * Several threshold reasons cite one, "(principle 5)", and a reader without
 * METHOD.md open cannot know what that is. A screen shows the title beside
 * the citation instead. `pnpm method:check` compares these titles with §1's
 * bold lines in both directions.
 *
 * Pure. No database, no clock, no network, no framework.
 */
export interface OperatingPrinciple {
  readonly number: number;
  /** §1's bold line, word for word. */
  readonly title: string;
}

export const OPERATING_PRINCIPLES: readonly OperatingPrinciple[] = [
  {
    number: 1,
    title: "Objectives are destinations, key results are the proof.",
  },
  { number: 2, title: "Prefer impact to effort." },
  { number: 3, title: "Focus is a decision." },
  { number: 4, title: "Know what kind of promise you are making." },
  { number: 5, title: "The rhythm is the product." },
  { number: 6, title: "Scores are planning data, not pay." },
  { number: 7, title: "Nothing carries over silently." },
  { number: 8, title: "Neglect must be visible." },
  { number: 9, title: "Alignment is contribution, not copying." },
  { number: 10, title: "Diagnose before you prescribe." },
  { number: 11, title: "Anybody can write." },
  { number: 12, title: "Defaults, not dogma." },
];

/** The principles a sentence cites as "principle N", once each, in order. */
export function principlesCited(text: string): readonly number[] {
  const numbers = [...text.matchAll(/\bprinciple (\d+)\b/gi)].map((match) =>
    Number(match[1]),
  );
  return [...new Set(numbers)];
}
