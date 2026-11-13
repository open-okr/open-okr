/**
 * The record the page in front of the member is about (plan 0.9.0 CP11,
 * UIUX-PLAN S-39).
 *
 * **Only the entity's id leaves the browser.** The panel never reads the page's
 * text. It names the record by kind and id, the server reads it as the member
 * through the copilot's own tools, and so nothing the member cannot see reaches
 * the model (decision CP11-Q).
 *
 * **A key result's page is its objective's.** No access-scoped read returns a
 * key result's title alone, while the objective's read already nests its key
 * results. So `?okr=<id>&kr=<id>` anchors to the objective, and the chip says
 * so rather than promising a key result.
 */

/** The kinds a conversation may be anchored to, as the thread stores them. */
export type SubjectKind = "goal" | "kpi" | "initiative" | "task";

export interface PageSubject {
  readonly type: SubjectKind;
  /** A short id or a UUID, as the address held it. */
  readonly id: string;
}

/** The first path segment of each entity page. */
const KIND_OF_SEGMENT: Readonly<Record<string, SubjectKind>> = {
  goals: "goal",
  kpis: "kpi",
  initiatives: "initiative",
  tasks: "task",
};

/** Pages that sit beside the entity pages and are not one. */
const NOT_AN_ID: ReadonlySet<string> = new Set([
  "studio",
  "recovery",
  "trees",
  "new",
]);

/**
 * The page's record, or null for a page that is not about one.
 *
 * An entity page wins over the objective drawer, because that is the page
 * the member is on. The drawer opens over Goals and over other pages through
 * `?okr=`, so any path may carry it.
 */
export function pageSubject(
  pathname: string | null,
  params: { get(name: string): string | null },
): PageSubject | null {
  const [segment, id] = (pathname ?? "").split("/").filter(Boolean);
  const type = segment ? KIND_OF_SEGMENT[segment] : undefined;
  if (type && id && !NOT_AN_ID.has(id)) {
    return { type, id: decodeURIComponent(id) };
  }
  const drawer = params.get("okr");
  return drawer ? { type: "goal", id: drawer } : null;
}

/** Catalogue keys, spelled out so the catalogue check can find each one. */
export const ASK_ABOUT_KEY: Readonly<Record<SubjectKind, string>> = {
  goal: "copilot.copilotPanel.askAbout.goal",
  kpi: "copilot.copilotPanel.askAbout.kpi",
  initiative: "copilot.copilotPanel.askAbout.initiative",
  task: "copilot.copilotPanel.askAbout.task",
};

export const ABOUT_KEY: Readonly<Record<SubjectKind, string>> = {
  goal: "copilot.copilotPanel.about.goal",
  kpi: "copilot.copilotPanel.about.kpi",
  initiative: "copilot.copilotPanel.about.initiative",
  task: "copilot.copilotPanel.about.task",
};

/** Two questions that need no setup, for an empty anchored conversation. */
export const ANCHORED_SUGGESTIONS = [
  "copilot.copilotPanel.anchoredSuggestion.progress",
  "copilot.copilotPanel.anchoredSuggestion.blocking",
] as const;

/** Whether two anchors name the same record. Addresses are compared as written. */
export const sameSubject = (
  a: PageSubject | null,
  b: PageSubject | null,
): boolean => a !== null && b !== null && a.type === b.type && a.id === b.id;
