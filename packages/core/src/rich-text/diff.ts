/**
 * The visual difference between two versions of a document (TECHNICAL-PLAN
 * §4.9, P5-T12).
 *
 * **Line by line, over plain text the shared module extracted.** The work-layer
 * design's §4.3 says the difference is computed from the stored editor JSON
 * through the one shared rich-text module, so the visual difference, the
 * excerpt, the plain text for search and the email rendering all come from the
 * same parser. This takes that plain text and says which lines were added,
 * removed or left alone.
 *
 * **A line, not a word.** A word-level difference reads better and needs a
 * tokeniser, an alignment and a set of heuristics about what counts as one edit.
 * A reader comparing two published versions of a plan wants to see which
 * paragraphs changed, and the line is the unit they think in. Recorded as a
 * choice rather than a limitation: a word-level pass can be added over this
 * without changing what a caller receives.
 *
 * The algorithm is the classic longest-common-subsequence walk. It is quadratic
 * in the number of lines, which is fine for a document and would not be for a
 * log: a caller comparing two things with thousands of lines should chunk them
 * first.
 *
 * Pure: no database, no framework.
 */

/**
 * Not exported. Both are reachable through `DiffResult.lines`, and exporting
 * them would be two names nothing imports.
 */
type DiffKind = "same" | "added" | "removed";

interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
}

/** How many lines this pass will look at before it gives up and says so. */
export const DIFF_LINE_LIMIT = 2000;

export interface DiffResult {
  readonly lines: readonly DiffLine[];
  readonly added: number;
  readonly removed: number;
  /**
   * True when one side was longer than `DIFF_LINE_LIMIT` and the comparison was
   * not attempted. The caller shows the new text rather than a difference,
   * which is honest: an unfinished comparison drawn as a finished one would
   * tell somebody nothing changed.
   */
  readonly truncated: boolean;
}

/**
 * The lines of one rendering, with the noise a round-trip leaves behind gone.
 *
 * Trailing spaces and repeated blank lines are not edits anybody made. A
 * document with nothing in it has no lines at all rather than one empty one:
 * without the first branch, comparing two empty documents reported a line,
 * which is a change where there was none.
 */
const split = (text: string): string[] => {
  if (text.trim() === "") {
    return [];
  }
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line !== "" || all[index - 1] !== "");
};

/**
 * What changed between two plain-text renderings, oldest first.
 *
 * Identical input gives every line as `same` and both counts at zero, which is
 * what a reader should see when a publish changed only the title.
 */
export function diffLines(before: string, after: string): DiffResult {
  const left = split(before);
  const right = split(after);

  if (left.length > DIFF_LINE_LIMIT || right.length > DIFF_LINE_LIMIT) {
    return {
      lines: right.map((text) => ({ kind: "same" as const, text })),
      added: 0,
      removed: 0,
      truncated: true,
    };
  }

  // `table[i][j]` is the length of the longest common subsequence of the first
  // `i` lines on the left and the first `j` on the right.
  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      const next = table[i + 1];
      if (!row || !next) {
        continue;
      }
      row[j] =
        left[i] === right[j]
          ? (next[j + 1] ?? 0) + 1
          : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push({ kind: "same", text: left[i] as string });
      i += 1;
      j += 1;
      continue;
    }
    const down = table[i + 1]?.[j] ?? 0;
    const across = table[i]?.[j + 1] ?? 0;
    if (down >= across) {
      lines.push({ kind: "removed", text: left[i] as string });
      removed += 1;
      i += 1;
    } else {
      lines.push({ kind: "added", text: right[j] as string });
      added += 1;
      j += 1;
    }
  }
  while (i < left.length) {
    lines.push({ kind: "removed", text: left[i] as string });
    removed += 1;
    i += 1;
  }
  while (j < right.length) {
    lines.push({ kind: "added", text: right[j] as string });
    added += 1;
    j += 1;
  }

  return { lines, added, removed, truncated: false };
}
