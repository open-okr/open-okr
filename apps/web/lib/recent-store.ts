/**
 * What this browser remembers a member opened (work-layer.md §5.1, G2-D1).
 *
 * **Per device and per workspace, and never sent anywhere on its own.** The
 * list is a hint for the palette's Recent group: the palette sends it to
 * `search.recent`, which re-reads each thing for the member and says which are
 * still theirs to open. Nothing about what anybody read is stored on a server.
 *
 * **Every read and write is wrapped.** A private window, blocked site data or a
 * full quota throws, and a blocked store means no recents, never an error on
 * the page that was being opened.
 *
 * No directive on purpose: the functions are plain, so the palette's server
 * action can share the list of kinds with the client that fills it.
 */

/** The kinds a member can open that have a page, as `search.recent` names them. */
export const RECENT_STORE_KINDS = [
  "goal",
  "key_result",
  "kpi",
  "initiative",
  "task",
  "person",
  "space",
] as const;

export type RecentStoreKind = (typeof RECENT_STORE_KINDS)[number];

export interface StoredRecent {
  readonly kind: RecentStoreKind;
  readonly id: string;
  /** Milliseconds since the epoch, when it was last opened. */
  readonly at: number;
}

/** The last twenty things opened, which is also the most the read takes. */
export const RECENT_STORE_LIMIT = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const recentStoreKey = (workspaceId: string) =>
  `openokr.recent.${workspaceId}`;

const isKind = (value: unknown): value is RecentStoreKind =>
  typeof value === "string" &&
  (RECENT_STORE_KINDS as readonly string[]).includes(value);

/**
 * Parses what the store holds. Anything that is not a well-formed entry is
 * dropped one by one, because the read refuses a whole list over one bad id
 * and a hand-edited or older entry must not cost the member every other one.
 */
function parse(raw: string | null): StoredRecent[] {
  if (raw === null) {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const kept: StoredRecent[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { kind, id, at } = entry as Record<string, unknown>;
    if (!isKind(kind) || typeof id !== "string" || !UUID.test(id)) {
      continue;
    }
    const key = `${kind}:${id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push({ kind, id, at: typeof at === "number" ? at : 0 });
  }
  return kept.slice(0, RECENT_STORE_LIMIT);
}

/** The list, newest first. Empty when the store is blocked or holds nothing. */
export function readRecents(workspaceId: string): StoredRecent[] {
  try {
    return parse(window.localStorage.getItem(recentStoreKey(workspaceId)));
  } catch {
    return [];
  }
}

function write(workspaceId: string, list: readonly StoredRecent[]): void {
  try {
    window.localStorage.setItem(
      recentStoreKey(workspaceId),
      JSON.stringify(list.slice(0, RECENT_STORE_LIMIT)),
    );
  } catch {
    // No store means no recents. The page being opened is not told.
  }
}

/** Records one open. A second open moves it to the top (G2-D2). */
export function recordRecent(
  workspaceId: string,
  kind: RecentStoreKind,
  id: string,
  now: number = Date.now(),
): void {
  if (!UUID.test(id)) {
    return;
  }
  const rest = readRecents(workspaceId).filter(
    (entry) => !(entry.kind === kind && entry.id === id),
  );
  write(workspaceId, [{ kind, id, at: now }, ...rest]);
}

/**
 * Keeps only what the server said the member may still open (G2-D3), in the
 * order the store had. Anything opened while the answer was coming is kept as
 * well, because it was not part of the question.
 */
export function pruneRecents(
  workspaceId: string,
  asked: readonly { readonly kind: string; readonly id: string }[],
  stillReadable: readonly { readonly kind: string; readonly id: string }[],
): void {
  const questioned = new Set(asked.map((one) => `${one.kind}:${one.id}`));
  const readable = new Set(stillReadable.map((one) => `${one.kind}:${one.id}`));
  const now = readRecents(workspaceId);
  const kept = now.filter((entry) => {
    const key = `${entry.kind}:${entry.id}`;
    return !questioned.has(key) || readable.has(key);
  });
  if (kept.length !== now.length) {
    write(workspaceId, kept);
  }
}

/**
 * What a location says was opened, oldest first so the last is the newest
 * (G2-D2): the page of an objective, a KPI, an initiative, a task, a person
 * or a space, and the drawer's `okr` and `kr` parameters, which open an
 * objective and one of its key results on any screen.
 *
 * A short link redirects to the page at its key before anything is drawn, so
 * the id here is always the key and never a short code.
 */
export function openedAt(
  pathname: string,
  params: Pick<URLSearchParams, "get">,
): { kind: RecentStoreKind; id: string }[] {
  const opened: { kind: RecentStoreKind; id: string }[] = [];
  const page = /^\/(goals|kpis|initiatives|tasks|people|spaces)\/([^/]+)/.exec(
    pathname,
  );
  if (page?.[2] && UUID.test(page[2])) {
    const kind = {
      goals: "goal",
      kpis: "kpi",
      initiatives: "initiative",
      tasks: "task",
      people: "person",
      spaces: "space",
    }[page[1] as string] as RecentStoreKind;
    opened.push({ kind, id: page[2] });
  }
  const objective = params.get("okr");
  if (objective && UUID.test(objective)) {
    opened.push({ kind: "goal", id: objective });
  }
  const keyResult = params.get("kr");
  if (keyResult && UUID.test(keyResult)) {
    opened.push({ kind: "key_result", id: keyResult });
  }
  return opened;
}
