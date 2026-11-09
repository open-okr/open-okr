/**
 * Short links (docs/design/short-ids.md S6, plan 0.7.0 D1).
 *
 * Every page of a cycle, a goal, an initiative, a task, a document and a
 * session has a "Copy link" that copies its address with the short id in it,
 * and each of those routes takes a short id and lands on the page. The page
 * itself still lives at its UUID in 0.7.0 (S1), so a short address is sent on
 * to the same page addressed by its key, with the query it came with.
 */

/** The kinds a page has a short link for. A key result opens on its goal. */
export type ShortLinkKind =
  | "cycle"
  | "goal"
  | "initiative"
  | "task"
  | "document"
  | "session";

const PAGE: Readonly<Record<ShortLinkKind, (address: string) => string>> = {
  cycle: (address) => `/cycle?cycle=${address}`,
  goal: (address) => `/goals/${address}`,
  initiative: (address) => `/initiatives/${address}`,
  task: (address) => `/tasks/${address}`,
  document: (address) => `/documents/${address}`,
  session: (address) => `/session/${address}`,
};

/** Something with a key and, once data change 0034 has reached it, a short id. */
export interface Addressed {
  readonly id: string;
  readonly shortId: string | null;
}

/**
 * The path "Copy link" copies. The key until the row has a short id, which
 * is only a row written before the upgrade and not yet reached by the data
 * change: a longer link is still a link.
 */
export function shortLinkPath(kind: ShortLinkKind, thing: Addressed): string {
  return PAGE[kind](encodeURIComponent(thing.shortId ?? thing.id));
}

/**
 * A key result's link. `/key-results/<short id>` opens its goal at its row;
 * without a short id, the goal's own address with the row's anchor.
 */
export function keyResultLinkPath(
  keyResult: Addressed & { readonly goalId: string },
): string {
  return keyResult.shortId
    ? `/key-results/${encodeURIComponent(keyResult.shortId)}`
    : `/goals/${keyResult.goalId}#kr-${keyResult.id}`;
}

/**
 * The page at `path`, keeping the query a short link arrived with. For the
 * redirect from a short address to the key every link on the page is built
 * from.
 */
export function withQuery(
  path: string,
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === "string") {
      search.append(name, value);
    } else if (value) {
      for (const one of value) {
        search.append(name, one);
      }
    }
  }
  const rest = search.toString();
  if (rest === "") {
    return path;
  }
  return `${path}${path.includes("?") ? "&" : "?"}${rest}`;
}
