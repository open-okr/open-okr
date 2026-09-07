/**
 * The minutes as one plain-text document (METHOD.md §8.10, P4-T12-a).
 *
 * One function, three consumers: the Markdown download, the PDF renderer and the
 * screen's copy-to-clipboard. A second formatter would be a second document that
 * says something slightly different, which for a record is worse than no export.
 *
 * Markdown rather than the editor's own format, because these minutes are read
 * outside the product: pasted into a wiki, mailed to a sponsor, kept in a folder.
 * `richTextFromPlainText` exists for the other direction and nothing here needs
 * it: every field the read hands over is already text or a plain-text excerpt.
 */

export interface Minutes {
  readonly title: string;
  readonly heldOn: string | null;
  readonly state: string;
  readonly summary: {
    readonly cycleScore: number | null;
    readonly verdict: string | null;
    readonly objectivesReviewed: number;
    readonly keyResultsReviewed: number;
    readonly belowThreshold: number;
    readonly threshold: number;
    readonly teamPulse: number | null;
    readonly learningsCarried: number;
    readonly actionsAgreed: number;
  };
  readonly scores: readonly {
    readonly goalTitle: string;
    readonly keyResultTitle: string;
    readonly score: number;
    readonly reason: string;
  }[];
  readonly narratives: readonly {
    readonly goalTitle: string;
    readonly excerpt: string | null;
  }[];
  readonly recognition: readonly {
    readonly toName: string;
    readonly fromName: string;
    readonly text: string;
  }[];
  readonly retro: readonly {
    readonly columnKey: string;
    readonly text: string;
    readonly votes: number;
  }[];
  readonly management:
    | readonly { readonly question: string; readonly body: string }[]
    | null;
  readonly rootCauses: readonly {
    readonly keyResultTitle: string;
    readonly cause: string;
    readonly detail: string | null;
  }[];
  readonly processHealth: readonly {
    readonly statement: string;
    readonly average: number;
  }[];
  readonly decisions: readonly {
    readonly goalTitle: string;
    readonly decision: string;
    readonly why: string;
  }[];
  readonly learnings: readonly {
    readonly text: string;
    readonly carryForward: boolean;
  }[];
  readonly drafts: readonly {
    readonly title: string;
    readonly why: string;
  }[];
  readonly actions: readonly {
    readonly what: string;
    readonly ownerName: string;
    readonly dueOn: string;
    readonly done: boolean;
  }[];
}

const VERDICTS: Record<string, string> = {
  results_delivered: "Results delivered",
  strategy_or_quality: "Strategy or OKR-quality problem",
  rhythm: "Rhythm problem",
};

const COLUMNS: Record<string, string> = {
  worked: "What worked",
  didnt: "What did not",
};

/** One section, or nothing at all when the stage produced nothing. */
function section(heading: string, lines: readonly string[]): string[] {
  if (lines.length === 0) {
    return [];
  }
  return ["", `## ${heading}`, "", ...lines];
}

export function minutesToMarkdown(minutes: Minutes): string {
  const lines: string[] = [`# ${minutes.title}`];
  if (minutes.heldOn) {
    lines.push("", `Held ${minutes.heldOn.slice(0, 10)}.`);
  }
  if (minutes.state !== "closed") {
    // Said plainly rather than left for the reader to work out. A document
    // exported mid-review is a draft, and a draft that does not say so gets
    // quoted as a record.
    lines.push(
      "",
      "**This review is still running. These minutes are a draft.**",
    );
  }

  const summary = minutes.summary;
  lines.push(
    "",
    "## Executive summary",
    "",
    `- Cycle score: ${summary.cycleScore === null ? "not read yet" : summary.cycleScore.toFixed(2)}`,
    `- Diagnostic: ${summary.verdict === null ? "not read yet" : (VERDICTS[summary.verdict] ?? summary.verdict)}`,
    `- Objectives reviewed: ${summary.objectivesReviewed}`,
    `- Key results reviewed: ${summary.keyResultsReviewed}`,
    `- Key results below ${summary.threshold.toFixed(1)}: ${summary.belowThreshold}`,
    `- Team pulse: ${summary.teamPulse === null ? "none given" : `${summary.teamPulse.toFixed(1)} of 5`}`,
    `- Learnings carried: ${summary.learningsCarried}`,
    `- Actions agreed: ${summary.actionsAgreed}`,
  );

  lines.push(
    ...section(
      "Scores",
      minutes.scores.map(
        (row) =>
          `- ${row.score.toFixed(1)} · ${row.keyResultTitle} (${row.goalTitle}) — ${row.reason}`,
      ),
    ),
    ...section(
      "Objective narratives",
      minutes.narratives
        .filter((row) => row.excerpt !== null)
        .map((row) => `- **${row.goalTitle}** — ${row.excerpt}`),
    ),
    ...section(
      "Recognition",
      minutes.recognition.map(
        (row) => `- ${row.toName}, named by ${row.fromName} — ${row.text}`,
      ),
    ),
    ...section(
      "Team retro",
      minutes.retro.map(
        (row) =>
          `- ${COLUMNS[row.columnKey] ?? row.columnKey}: ${row.text} (${row.votes} ${row.votes === 1 ? "dot" : "dots"})`,
      ),
    ),
    ...section(
      "Management retro",
      // Absent entirely for a reader who may not see it: the read hands back
      // null rather than an empty list, so this cannot render a heading over
      // nothing and imply the stage was skipped.
      (minutes.management ?? []).map(
        (row) => `- ${row.question}\n  ${row.body}`,
      ),
    ),
    ...section(
      "Root causes",
      minutes.rootCauses.map(
        (row) =>
          `- ${row.keyResultTitle}: ${row.cause}${row.detail ? ` — ${row.detail}` : ""}`,
      ),
    ),
    ...section(
      "Process health",
      minutes.processHealth.map(
        (row) => `- ${row.average.toFixed(1)} · ${row.statement}`,
      ),
    ),
    ...section(
      "Keep, modify or abandon",
      minutes.decisions.map(
        (row) => `- ${row.decision}: ${row.goalTitle} — ${row.why}`,
      ),
    ),
    ...section(
      "Learnings",
      minutes.learnings.map(
        (row) => `- ${row.text}${row.carryForward ? " (carried)" : ""}`,
      ),
    ),
    ...section(
      "Next-cycle drafts",
      minutes.drafts.map((row) => `- ${row.title} — ${row.why}`),
    ),
    ...section(
      "Actions",
      minutes.actions.map(
        (row) =>
          `- ${row.done ? "[x]" : "[ ]"} ${row.what} — ${row.ownerName}, by ${row.dueOn}`,
      ),
    ),
  );

  return `${lines.join("\n")}\n`;
}

/** A filename a person can find again in a downloads folder. */
export function minutesFilename(minutes: Minutes, extension: string): string {
  const slug = minutes.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const day = (minutes.heldOn ?? new Date().toISOString()).slice(0, 10);
  return `${slug || "review"}-minutes-${day}.${extension}`;
}
