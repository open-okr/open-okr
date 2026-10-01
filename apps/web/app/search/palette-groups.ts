/**
 * What the command palette lists, and in which group (UIUX-PLAN §3 and §4
 * S-32, completeness review M-21).
 *
 * Kept apart from the component so the grouping can be read, and tested,
 * without a browser: which rows exist for a phrase is a question about data,
 * and the component's job is to draw them and move between them.
 *
 * | Group | Holds | Shown |
 * |---|---|---|
 * | Go to | Things of every kind whose name matches, and a KPI a short code names | When something matches |
 * | Search results | Full-text matches not already under Go to | When something matches |
 * | Related | Semantic matches | Only with an AI provider, and only when it found something |
 * | Actions | Commands and pages, filtered by the phrase | Always, and alone before anything is typed |
 */

/** One thing the palette can open. */
interface PaletteEntry {
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  readonly href: string;
}

/** One search result, with the matching words marked by `<b>`. */
export interface PaletteHit extends PaletteEntry {
  readonly snippet: string;
}

/** The fast answer: the jump and full text, never waiting on a model. */
export interface PaletteAnswer {
  readonly goTo: readonly PaletteEntry[];
  readonly hits: readonly PaletteHit[];
  readonly error: string | null;
}

export const EMPTY_ANSWER: PaletteAnswer = { goTo: [], hits: [], error: null };

/**
 * A command the palette offers. One with an `href` navigates; one without
 * runs in place, and its `id` says what it runs.
 */
export interface PaletteCommand {
  readonly id: string;
  readonly title: string;
  /** A second line, such as which part of the product a page is in. */
  readonly hint: string | null;
  readonly href: string | null;
}

export interface PaletteRow {
  /** Unique within the palette, and safe inside an element id. */
  readonly id: string;
  readonly title: string;
  /** A catalogue key naming the kind, for a row that is a thing. */
  readonly kind: string | null;
  /** A snippet with `<b>` marks, or a command's hint. */
  readonly detail: string | null;
  readonly href: string | null;
  /** The command a row runs in place, when it does not navigate. */
  readonly command: string | null;
}

export type PaletteGroupId = "goTo" | "results" | "related" | "actions";

export interface PaletteGroup {
  readonly id: PaletteGroupId;
  readonly rows: readonly PaletteRow[];
}

/**
 * What to call each kind of thing, as a catalogue key. A kind with no name
 * here is shown without one rather than as its raw database word.
 */
export const KIND_LABEL: Readonly<Record<string, string>> = {
  goal: "search.objective",
  key_result: "common.keyResult",
  kpi: "kpis.grid.kpi",
  initiative: "search.initiative",
  task: "search.task",
  document: "search.document",
  comment: "search.comment",
  check_in: "search.checkIn",
  session: "search.session",
  space: "search.space",
  person: "search.person",
  cycle: "search.cycle",
};

const keyOf = (entry: PaletteEntry) => `${entry.entityType}:${entry.entityId}`;

/** An element id from a key. A colon is legal in an id and awkward in a selector. */
const rowId = (prefix: string, key: string) =>
  `${prefix}-${key.replaceAll(":", "-")}`;

/**
 * Whether a command answers a phrase: every word of it appears in the title or
 * the hint, in any case. "dark" finds the theme switch, "settings" finds every
 * administration page.
 */
function commandMatches(command: PaletteCommand, phrase: string): boolean {
  const words = phrase.trim().toLocaleLowerCase().split(/\s+/);
  const text = `${command.title} ${command.hint ?? ""}`.toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

const commandRow = (command: PaletteCommand): PaletteRow => ({
  id: rowId("command", command.id),
  title: command.title,
  kind: null,
  detail: command.hint,
  href: command.href,
  command: command.href === null ? command.id : null,
});

const hitRow =
  (prefix: string) =>
  (hit: PaletteHit): PaletteRow => ({
    id: rowId(prefix, keyOf(hit)),
    title: hit.title,
    kind: KIND_LABEL[hit.entityType] ?? null,
    detail: hit.snippet,
    href: hit.href,
    command: null,
  });

/**
 * The groups for one phrase, in the order they are drawn.
 *
 * Nothing is listed twice. A thing already offered under Go to is dropped from
 * both kinds of result, and a related result that full text also found is
 * dropped from Related, because the words matching is the stronger reason.
 */
export function paletteGroups(
  phrase: string,
  answer: PaletteAnswer,
  related: readonly PaletteHit[],
  commands: readonly PaletteCommand[],
): readonly PaletteGroup[] {
  const typed = phrase.trim();
  if (typed === "") {
    return commands.length === 0
      ? []
      : [{ id: "actions", rows: commands.map(commandRow) }];
  }

  const offered = new Set(answer.goTo.map(keyOf));
  const goTo = answer.goTo.map(
    (entry): PaletteRow => ({
      id: rowId("goto", keyOf(entry)),
      title: entry.title,
      kind: KIND_LABEL[entry.entityType] ?? null,
      detail: null,
      href: entry.href,
      command: null,
    }),
  );
  const results = answer.hits.filter((hit) => !offered.has(keyOf(hit)));
  for (const hit of results) {
    offered.add(keyOf(hit));
  }

  const groups: PaletteGroup[] = [
    { id: "goTo", rows: goTo },
    { id: "results", rows: results.map(hitRow("hit")) },
    {
      id: "related",
      rows: related
        .filter((hit) => !offered.has(keyOf(hit)))
        .map(hitRow("related")),
    },
    {
      id: "actions",
      rows: commands
        .filter((command) => commandMatches(command, typed))
        .map(commandRow),
    },
  ];
  return groups.filter((group) => group.rows.length > 0);
}
