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
 * | Recent | What this member opened lately, at most eight | Before anything is typed, first |
 * | Go to | Things of every kind whose name matches, and a KPI a short code names | When something matches |
 * | Search results | Full-text matches not already under Go to | When something matches |
 * | Related | Semantic matches | Only with an AI provider, and only when it found something |
 * | Actions | Commands and pages, filtered by the phrase | Always, and alone before anything is typed |
 */

/** One thing the palette can open. */
export interface PaletteEntry {
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

export type PaletteGroupId =
  | "recent"
  | "goTo"
  | "results"
  | "related"
  | "actions";

/** How many recents the palette draws, whatever the server returned. */
export const RECENT_SHOWN = 8;

/**
 * The scoped tabs (work-layer.md §5.1, G2-D6). A tab narrows every group to
 * the kinds it names. `kinds` is `null` for All, and the kinds are the
 * entity names `search.entities` and the index use.
 */
export const PALETTE_TABS = [
  { id: "all", label: "search.everything", kinds: null },
  { id: "objectives", label: "search.objectives", kinds: ["goal"] },
  {
    id: "keyResults",
    label: "cycle.reviewAndLearn.keyResults",
    kinds: ["key_result"],
  },
  { id: "kpis", label: "pageTitle.kpis", kinds: ["kpi"] },
  { id: "initiatives", label: "common.initiatives", kinds: ["initiative"] },
  { id: "tasks", label: "search.tasks", kinds: ["task"] },
  { id: "people", label: "people.people", kinds: ["person"] },
] as const;

export type PaletteTab = (typeof PALETTE_TABS)[number];
export type PaletteTabId = PaletteTab["id"];

/**
 * A tab by the id a server action was handed. The id arrives from the
 * browser, so an unknown one means All rather than an error.
 */
export function paletteTab(id: string | undefined): PaletteTab {
  return PALETTE_TABS.find((tab) => tab.id === id) ?? PALETTE_TABS[0];
}

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
 * Whether a thing belongs on the tab. All takes everything. A scoped tab takes
 * only the kinds it names, so a recent is filtered by the same rule as a result.
 */
const onTab = (entry: PaletteEntry, kinds: readonly string[] | null) =>
  kinds === null || kinds.includes(entry.entityType);

/**
 * Orders a group's rows for a phrase (G2-D5). A title that is exactly what was
 * typed comes first, and a recent one among those first of all. Below the exact
 * titles a recent is lifted above the rest. The sort is stable, so the
 * server's own order holds inside each band.
 */
function liftRecent<T extends PaletteEntry>(
  entries: readonly T[],
  phrase: string,
  recent: ReadonlySet<string>,
): T[] {
  const typed = phrase.toLocaleLowerCase();
  const band = (entry: T) => {
    const exact = entry.title.trim().toLocaleLowerCase() === typed;
    const lately = recent.has(keyOf(entry));
    return exact ? (lately ? 0 : 1) : lately ? 2 : 3;
  };
  return entries
    .map((entry, position) => ({ entry, position, band: band(entry) }))
    .sort((a, b) => a.band - b.band || a.position - b.position)
    .map((one) => one.entry);
}

/**
 * The groups for one phrase, in the order they are drawn.
 *
 * Nothing is listed twice. A thing already offered under Go to is dropped from
 * both kinds of result, and a related result that full text also found is
 * dropped from Related, because the words matching is the stronger reason.
 *
 * **A scoped tab has no Actions group.** The actions are pages and commands,
 * and a tab that says "Tasks" is a promise that only tasks appear.
 */
export function paletteGroups(
  phrase: string,
  answer: PaletteAnswer,
  related: readonly PaletteHit[],
  commands: readonly PaletteCommand[],
  recent: readonly PaletteEntry[] = [],
  tabKinds: readonly string[] | null = null,
): readonly PaletteGroup[] {
  const typed = phrase.trim();
  const actions = tabKinds === null ? commands : [];
  if (typed === "") {
    const lately = recent
      .filter((entry) => onTab(entry, tabKinds))
      .slice(0, RECENT_SHOWN);
    return [
      {
        id: "recent" as const,
        rows: lately.map(
          (entry): PaletteRow => ({
            id: rowId("recent", keyOf(entry)),
            title: entry.title,
            kind: KIND_LABEL[entry.entityType] ?? null,
            detail: null,
            href: entry.href,
            command: null,
          }),
        ),
      },
      { id: "actions" as const, rows: actions.map(commandRow) },
    ].filter((group) => group.rows.length > 0);
  }

  const lately = new Set(recent.map(keyOf));
  const goToEntries = liftRecent(
    answer.goTo.filter((entry) => onTab(entry, tabKinds)),
    typed,
    lately,
  );
  const offered = new Set(goToEntries.map(keyOf));
  const goTo = goToEntries.map(
    (entry): PaletteRow => ({
      id: rowId("goto", keyOf(entry)),
      title: entry.title,
      kind: KIND_LABEL[entry.entityType] ?? null,
      detail: null,
      href: entry.href,
      command: null,
    }),
  );
  const results = liftRecent(
    answer.hits.filter(
      (hit) => !offered.has(keyOf(hit)) && onTab(hit, tabKinds),
    ),
    typed,
    lately,
  );
  for (const hit of results) {
    offered.add(keyOf(hit));
  }

  const groups: PaletteGroup[] = [
    { id: "goTo", rows: goTo },
    { id: "results", rows: results.map(hitRow("hit")) },
    {
      id: "related",
      rows: liftRecent(
        related.filter(
          (hit) => !offered.has(keyOf(hit)) && onTab(hit, tabKinds),
        ),
        typed,
        lately,
      ).map(hitRow("related")),
    },
    {
      id: "actions",
      rows: actions
        .filter((command) => commandMatches(command, typed))
        .map(commandRow),
    },
  ];
  return groups.filter((group) => group.rows.length > 0);
}
