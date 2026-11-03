/**
 * METHOD.md's numbered headings, so a screen can send a reader to the exact
 * section a setting, a threshold or a rule comes from rather than to the top
 * of a long document.
 *
 * `pnpm method:check` compares this table with the document's own headings in
 * both directions, and refuses a setting or a threshold that cites a section
 * not in it. A renamed heading fails the build instead of leaving a link that
 * quietly lands at the top of the page.
 *
 * Pure. No database, no clock, no network, no framework.
 */
export const METHOD_SECTIONS: Readonly<Record<string, string>> = {
  "1": "The operating principles",
  "2": "The cycle model",
  "2.1": "Two horizons",
  "2.2": "The eight phases",
  "2.3": "Phase completion rules",
  "2.4": "Timeline",
  "2.5": "Roles",
  "2.6": "The input pack",
  "2.7": "Levels and quantities",
  "2.8": "Committed and aspirational OKRs",
  "2.9": "Writing and changing OKRs at any time",
  "2.10": "Kinds of key result",
  "3": "Scoring, confidence and health",
  "3.1": "Progress",
  "3.2": "Confidence bands",
  "3.3": "Score bands",
  "3.4": "Portfolio verdict",
  "3.5": "Health",
  "3.6": "Trend forecast",
  "3.7": "The progress signal",
  "4": "The quality canon",
  "4.1": "Objective checks",
  "4.2": "Key result checks",
  "4.3": "Alignment checks",
  "4.4": "Cycle checks",
  "4.5": "Publish gates",
  "4.6": "Weak and strong examples",
  "5": "Alignment",
  "5.1": "Two directions",
  "5.2": "Alignment health score",
  "5.3": "Semantic review",
  "5.4": "Dependencies",
  "5.5": "Capacity",
  "6": "KPIs and recovery OKRs",
  "6.1": "What a KPI is here",
  "6.2": "KPI attributes",
  "6.3": "The KPI tree",
  "6.4": "Health corridors",
  "6.5": "Responding to an unhealthy KPI",
  "6.6": "Recovery board",
  "6.7": "Calculated KPIs",
  "7": "The rhythm",
  "7.1": "The three rituals",
  "7.2": "The weekly check-in, in four steps",
  "7.3": "Blocker taxonomy",
  "7.4": "The rhythm streak, holidays and leave",
  "7.5": "Monthly review",
  "7.6": "Mid-cycle calibration",
  "8": "The quarterly review",
  "8.1": "The stages",
  "8.2": "Room pulse",
  "8.3": "Scoring reveal",
  "8.4": "Root causes",
  "8.5": "Process health",
  "8.6": "The rhythm diagnostic",
  "8.7": "Management retro",
  "8.8": "Keep, modify, abandon or defer",
  "8.9": "Learnings and feed-forward",
  "8.10": "Minutes",
  "9": "Facilitator guidance",
  "10": "What the coach watches for",
  "11": "The threshold registry",
  "12": "Practice settings and profiles",
  "12.1": "The settings",
  "12.2": "Profiles",
  "12.3": "The profiles compared",
  "13": "Sources",
};

/** The §4 subsection that sets out each group of checks, by id prefix. */
const CHECK_SECTIONS: Readonly<Record<string, string>> = {
  OBJ: "4.1",
  KR: "4.2",
  AL: "4.3",
  CY: "4.4",
};

/**
 * Where METHOD.md sets out a quality check: its group's subsection, because a
 * check is a bold paragraph rather than a heading of its own. §4 for an id
 * with no known prefix.
 */
export function checkSection(checkId: string): string {
  return CHECK_SECTIONS[checkId.split("-")[0] ?? ""] ?? "4";
}

/**
 * The anchor a Markdown renderer gives a section's heading: "2.9 Writing and
 * changing OKRs at any time" is `29-writing-and-changing-okrs-at-any-time`.
 * A citation of several sections, "4.1, 4.2", links to the first. Null for a
 * section METHOD.md does not have, so a caller links to the document's top
 * rather than to an anchor that goes nowhere.
 */
export function methodSectionAnchor(citation: string): string | null {
  const section = citation.split(",")[0]?.trim() ?? "";
  const title = METHOD_SECTIONS[section];
  if (title === undefined) {
    return null;
  }
  return `${section} ${title}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}
