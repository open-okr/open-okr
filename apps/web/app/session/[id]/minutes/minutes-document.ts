import { serverTranslate } from "@openokr/core";
import { intlTagFor, type MessageValues } from "@openokr/formats";
import { dayLabel } from "../../../../lib/day-label";

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
    /** Committed key results met, apart from the score (§8.10, P9-T20e-b). */
    readonly committed: { readonly met: number; readonly reviewed: number };
    readonly verdict: string | null;
    readonly objectivesReviewed: number;
    readonly keyResultsReviewed: number;
    readonly belowThreshold: number;
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
  results_delivered: "verdictDelivered",
  strategy_or_quality: "verdictStrategy",
  rhythm: "verdictRhythm",
};

const COLUMNS: Record<string, string> = {
  worked: "retroWorked",
  didnt: "retroDidnt",
};

/** One section, or nothing at all when the stage produced nothing. */
function section(heading: string, lines: readonly string[]): string[] {
  if (lines.length === 0) {
    return [];
  }
  return ["", `## ${heading}`, "", ...lines];
}

/** Pass a locale for the human-facing PDF and print view. */
export function minutesToMarkdown(minutes: Minutes, locale?: string): string {
  const t = (key: string, values?: MessageValues) =>
    serverTranslate(locale ?? "en", `minutes.${key}`, values);
  const numberFormat = (digits: number) =>
    new Intl.NumberFormat(intlTagFor(locale), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  const formats = locale
    ? ([numberFormat(0), numberFormat(1), numberFormat(2)] as const)
    : undefined;
  const number = (value: number, digits: 0 | 1 | 2 = 0) =>
    formats?.[digits].format(value) ?? value.toFixed(digits);
  const date = (value: string) => (locale ? dayLabel(value, locale) : value);

  const lines: string[] = [`# ${minutes.title}`];
  if (minutes.heldOn) {
    lines.push("", t("held", { date: date(minutes.heldOn.slice(0, 10)) }));
  }
  if (minutes.state !== "closed") {
    // Said plainly rather than left for the reader to work out. A document
    // exported mid-review is a draft, and a draft that does not say so gets
    // quoted as a record.
    lines.push("", `**${t("draft")}**`);
  }

  const summary = minutes.summary;
  const verdict =
    summary.verdict === null ? undefined : VERDICTS[summary.verdict];
  const score =
    summary.cycleScore === null
      ? t("notReadYet")
      : number(summary.cycleScore, 2);
  const committed =
    summary.committed.reviewed === 0
      ? t("noneCommitted")
      : t("metOf", {
          met: number(summary.committed.met),
          reviewed: number(summary.committed.reviewed),
        });
  const pulse =
    summary.teamPulse === null
      ? t("noneGiven")
      : t("pulseOf", {
          value: number(summary.teamPulse, 1),
          maximum: number(5),
        });
  lines.push(
    "",
    `## ${t("executiveSummary")}`,
    "",
    `- ${t("cycleScore", { value: score })}`,
    `- ${t("committedMet", { value: committed })}`,
    `- ${t("diagnostic", { value: verdict ? t(verdict) : (summary.verdict ?? t("notReadYet")) })}`,
    `- ${t("objectivesReviewed", { total: number(summary.objectivesReviewed) })}`,
    `- ${t("keyResultsReviewed", { total: number(summary.keyResultsReviewed) })}`,
    `- ${t("belowThreshold", { total: number(summary.belowThreshold) })}`,
    `- ${t("teamPulse", { value: pulse })}`,
    `- ${t("learningsCarried", { total: number(summary.learningsCarried) })}`,
    `- ${t("actionsAgreed", { total: number(summary.actionsAgreed) })}`,
  );

  lines.push(
    ...section(
      t("scores"),
      minutes.scores.map(
        (row) =>
          `- ${number(row.score, 1)} · ${row.keyResultTitle} (${row.goalTitle}) — ${row.reason}`,
      ),
    ),
    ...section(
      t("narratives"),
      minutes.narratives
        .filter((row) => row.excerpt !== null)
        .map((row) => `- **${row.goalTitle}** — ${row.excerpt}`),
    ),
    ...section(
      t("recognition"),
      minutes.recognition.map(
        (row) =>
          `- ${t("recognitionLine", { to: row.toName, from: row.fromName, text: row.text })}`,
      ),
    ),
    ...section(
      t("teamRetro"),
      minutes.retro.map((row) => {
        const key = COLUMNS[row.columnKey];
        const votes = t("votes", {
          count: row.votes,
          votes: number(row.votes),
        });
        return `- ${key ? t(key) : row.columnKey}: ${row.text} (${votes})`;
      }),
    ),
    ...section(
      t("managementRetro"),
      // Absent entirely for a reader who may not see it: the read hands back
      // null rather than an empty list, so this cannot render a heading over
      // nothing and imply the stage was skipped.
      (minutes.management ?? []).map(
        (row) => `- ${row.question}\n  ${row.body}`,
      ),
    ),
    ...section(
      t("rootCauses"),
      minutes.rootCauses.map(
        (row) =>
          `- ${row.keyResultTitle}: ${row.cause}${row.detail ? ` — ${row.detail}` : ""}`,
      ),
    ),
    ...section(
      t("processHealth"),
      minutes.processHealth.map(
        (row) => `- ${number(row.average, 1)} · ${row.statement}`,
      ),
    ),
    ...section(
      t("decisions"),
      minutes.decisions.map(
        (row) => `- ${row.decision}: ${row.goalTitle} — ${row.why}`,
      ),
    ),
    ...section(
      t("learnings"),
      minutes.learnings.map(
        (row) =>
          `- ${row.carryForward ? t("carriedLearning", { text: row.text }) : row.text}`,
      ),
    ),
    ...section(
      t("drafts"),
      minutes.drafts.map((row) => `- ${row.title} — ${row.why}`),
    ),
    ...section(
      t("actions"),
      minutes.actions.map(
        (row) =>
          `- ${row.done ? "[x]" : "[ ]"} ${t("actionLine", { what: row.what, owner: row.ownerName, dueOn: date(row.dueOn) })}`,
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
