#!/usr/bin/env node
/**
 * The conformance suite: `pnpm method:check` (P4-T01g).
 *
 * `packages/method` is METHOD.md compiled. This is the gate that refuses the
 * build when the two disagree, which is the only thing that keeps "the method
 * is in the product" true after the first person edits one and not the other.
 *
 * It does three things, from the P4-T00 design document §16:
 *
 *  1. **Rule-key coverage.** Every key the documents cite resolves inside the
 *     package. A coaching message citing a rule nothing defines is a build
 *     failure, and this is where that is decided.
 *  2. **Threshold drift.** Every parameter METHOD.md §11 lists exists in the
 *     registry, and the registry invents none the document does not carry.
 *  3. **Corpus coverage.** Every corpus entry the design document approved is
 *     exercised by a test. An approved expectation nobody runs is not an
 *     expectation.
 *
 * It reads the documents rather than a transcription of them. A check written
 * against a copy of the document drifts with the copy.
 *
 * Usage: method-check
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALIGNMENT_CHECKS,
  BLOCKER_TYPE_DEFINITIONS,
  canonThresholds,
  CLOSE_DECISION_MEANINGS,
  CYCLE_CHECKS,
  isTriggerKey,
  GATE_TITLES,
  KEY_RESULT_CHECKS,
  MANAGEMENT_RETRO_QUESTIONS,
  OBJECTIVE_CHECKS,
  PHASE_TITLES,
  PROCESS_HEALTH_STATEMENTS,
  QUALITY_WORD_LISTS,
  REVIEW_STAGES,
  RITUALS,
  rhythmDiagnostic,
  roomPulseRead,
  ROOT_CAUSES,
  THRESHOLDS,
  WEEKLY_STEPS,
} from "../packages/method/src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const method = read("docs", "development-plan", "METHOD.md");
const aiPlan = read("docs", "development-plan", "AI-NATIVE-PLAN.md");
const methodDesign = read("docs", "design", "p4-t00-method-package.md");
const agentDesign = read("docs", "design", "p4-t00-agent-design.md");
const qualityTests = read("packages", "method", "test", "quality.test.ts");

const NEWLINE = String.fromCharCode(10);

const problems: string[] = [];
const fail = (what: string, detail: string) =>
  problems.push(`${what}: ${detail}`);

/** The slice of a document between two headings. */
const section = (doc: string, from: string, to: string): string => {
  const start = doc.indexOf(from);
  if (start === -1) {
    fail("parse", `cannot find "${from}"`);
    return "";
  }
  const end = doc.indexOf(to, start + from.length);
  return doc.slice(start, end === -1 ? undefined : end);
};

/** Every `back-ticked.key` in the first column of a markdown table. */
const firstColumnKeys = (body: string): string[] =>
  body
    .split("\n")
    .map((line) => /^\|\s*`([A-Za-z][\w.-]*)`\s*\|/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);

/** Every plain-text label in the first column of a markdown table. */
const firstColumnLabels = (body: string): string[] =>
  body
    .split("\n")
    .map((line) => /^\|\s*([A-Z][^|`]*?)\s*\|/.exec(line)?.[1])
    .filter((label): label is string => label !== undefined)
    .filter((label) => label !== "Parameter");

const CHECK_IDS = new Set(
  [
    ...OBJECTIVE_CHECKS,
    ...KEY_RESULT_CHECKS,
    ...ALIGNMENT_CHECKS,
    ...CYCLE_CHECKS,
  ].map((entry) => entry.id),
);

// --- 1. Rule-key coverage ---------------------------------------------------

const triggerKeys = firstColumnKeys(
  section(aiPlan, "### 6.4 The full trigger catalogue", "### 6.5"),
);
// A parse that finds nothing agrees with everything, so the count is checked
// before the contents. This guard is the reason a broken regex cannot pass.
if (triggerKeys.length < 40) {
  fail(
    "rule keys",
    `only ${triggerKeys.length} trigger keys found in AI-NATIVE-PLAN.md §6.4; the parse is wrong, not the document`,
  );
}
for (const key of triggerKeys) {
  if (!isTriggerKey(key)) {
    fail("rule keys", `AI-NATIVE-PLAN.md §6.4 cites \`${key}\`, which the package does not define`);
  }
}

const watchList = firstColumnKeys(
  section(methodDesign, "## 11. The coach watch list", "## 12."),
);
const watchListRuleKeys = section(
  methodDesign,
  "## 11. The coach watch list",
  "## 12.",
)
  .split("\n")
  .map((line) => /\|\s*`([A-Za-z][\w.-]*)`\s*\|\s*$/.exec(line)?.[1])
  .filter((key): key is string => key !== undefined);
for (const key of watchListRuleKeys) {
  if (!isTriggerKey(key) && !CHECK_IDS.has(key)) {
    fail(
      "rule keys",
      `the METHOD.md §10 watch list cites \`${key}\`, which is neither a trigger nor a check the package defines`,
    );
  }
}
if (watchListRuleKeys.length < 20) {
  fail(
    "rule keys",
    `only ${watchListRuleKeys.length} watch-list keys found; METHOD.md §10 lists twenty situations`,
  );
}
void watchList;

const agentTriggerKeys = firstColumnKeys(
  section(agentDesign, "## 3. The trigger catalogue", "### 3.3"),
);
for (const key of agentTriggerKeys) {
  if (!isTriggerKey(key)) {
    fail(
      "rule keys",
      `the P4-T00 agent design cites \`${key}\`, which the package does not define`,
    );
  }
}

// --- 2. Threshold drift -----------------------------------------------------

const documented = new Set(
  firstColumnLabels(section(method, "## 11. The threshold registry", "\n---\n")),
);
if (documented.size < 40) {
  fail(
    "thresholds",
    `only ${documented.size} parameters found in METHOD.md §11; the parse is wrong, not the document`,
  );
}
const registered = new Map(
  Object.entries(THRESHOLDS).map(([key, param]) => [param.label, key]),
);
for (const label of documented) {
  if (!registered.has(label)) {
    fail(
      "thresholds",
      `METHOD.md §11 lists "${label}" and the registry has no parameter with that label`,
    );
  }
}
for (const [label, key] of registered) {
  if (!documented.has(label)) {
    fail(
      "thresholds",
      `the registry carries \`${key}\` labelled "${label}", which METHOD.md §11 does not list. A value not in the registry is not a setting`,
    );
  }
}

// --- 3. Word lists ----------------------------------------------------------

// The lists §4 fires on, compared term by term against §4.1's and §4.2's own
// tables. This check was added after "prefer" was missing from the state words
// and METHOD.md §4.6's own strong example warned against its own rule for it.
// A word list is data the practice depends on, so a term added to one and not
// the other is drift like any other.
const LIST_ROWS: readonly (readonly [string, keyof typeof QUALITY_WORD_LISTS])[] =
  [
    ["| Output verbs |", "outputVerbs"],
    ["| Movement verbs |", "movementVerbs"],
    ["| State words |", "stateWords"],
    ["| Why markers |", "whyMarkers"],
    ["| Activity nouns |", "activityNouns"],
    ["| Impact words |", "impactWords"],
  ];

for (const [rowLabel, listName] of LIST_ROWS) {
  const line = method
    .split(NEWLINE)
    .find((candidate) => candidate.startsWith(rowLabel));
  if (!line) {
    fail("word lists", `METHOD.md has no "${rowLabel.trim()}" row`);
    continue;
  }
  const documentedTerms = (line.split("|")[2] ?? "")
    .replace(/\(and plurals\)/i, "")
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term !== "");
  const defined = new Set<string>(QUALITY_WORD_LISTS[listName]);
  for (const term of documentedTerms) {
    // The activity nouns row ends "(and plurals)", so a plural the package
    // carries is expected to be absent from the document rather than missing
    // from the package. The document's own singulars all have to be present.
    if (!defined.has(term)) {
      fail(
        "word lists",
        `METHOD.md lists "${term}" under ${rowLabel.trim()} and the package's ${listName} does not carry it`,
      );
    }
  }
  for (const term of defined) {
    const plural = term.endsWith("s") && documentedTerms.includes(term.slice(0, -1));
    const irregular =
      term === "activities" && documentedTerms.includes("activity");
    if (!documentedTerms.includes(term) && !plural && !irregular) {
      fail(
        "word lists",
        `the package's ${listName} carries "${term}" and METHOD.md does not list it`,
      );
    }
  }
}

// --- 4. Corpus coverage -----------------------------------------------------

const corpusEntries = [
  ...section(methodDesign, "## 15. The OKR corpus", "## 16.").matchAll(
    /^### Corpus entry (\d+): (.+)$/gm,
  ),
].map((match) => ({ number: match[1] as string, title: match[2] as string }));

if (corpusEntries.length === 0) {
  fail("corpus", "no corpus entries found in the design document");
}
for (const entry of corpusEntries) {
  // The test names the entry it drives, so the link is readable in the test
  // output rather than kept in somebody's head.
  if (!qualityTests.includes(`corpus entry ${entry.number}`)) {
    fail(
      "corpus",
      `corpus entry ${entry.number} ("${entry.title}") is approved and no test names it`,
    );
  }
}

// --- §8.2's read of the room (P4-T10a-b) ------------------------------------
//
// A facilitator acts on these three sentences, so the package must carry them
// word for word. The method test suite already asserts each one appears in
// METHOD.md; this is the other direction, and the one that matters when
// somebody edits the document: every read the document lists has to be a read
// the package can produce.

const roomPulseSection = section(method, "### 8.2 Room pulse", "### 8.3");
const documentedReads = roomPulseSection
  .split(NEWLINE)
  .map((line) => /^\|\s*(?:[^|]+)\|\s*([^|]+?)\s*\|$/.exec(line)?.[1])
  .filter((read): read is string => read !== undefined && read !== "Read")
  .filter((read) => !/^-+$/.test(read));

if (documentedReads.length !== 3) {
  fail(
    "room pulse",
    `found ${documentedReads.length} reads in METHOD.md §8.2; the parse is wrong, not the document`,
  );
}

const packageReads = [
  roomPulseRead([5], canonThresholds()),
  roomPulseRead([3.5], canonThresholds()),
  roomPulseRead([1], canonThresholds()),
].map((entry) => entry?.read);

for (const documentedRead of documentedReads) {
  if (!packageReads.includes(documentedRead)) {
    fail(
      "room pulse",
      `METHOD.md §8.2 reads "${documentedRead}", which packages/method does not produce for any band`,
    );
  }
}

/**
 * How many of METHOD.md's own lists are compared below.
 *
 * Printed on success, because a conformance suite that says "passed" without
 * saying what it looked at is a suite nobody notices has stopped looking.
 * Raise it when you add a list.
 */
const ENUMERATIONS_CHECKED = 18;

// --- 5. The enumerations (P7-T07) -------------------------------------------
//
// **The gap this audit found.** Everything above checks the rules that fire
// and the numbers they fire on: the trigger keys, the §11 registry, the word
// lists, the corpus. None of it checked a single one of METHOD.md's
// *enumerations*, and those are most of what §2, §7 and §8 are made of: the
// eight phases, the six publish gates, the eight root causes, the five
// blocker types, the three rituals, the four weekly steps, the
// process-health statements and the management retro questions.
//
// A taxonomy that has drifted is drift like any other. The five blocker
// types are a closed list a facilitator picks from during a session, so an
// item added to the document and not to the package is an option the product
// will never offer, and nothing before this would have said so.
//
// Each list is compared in both directions and in order. Order matters for
// the phases because they are a sequence people walk through, and for the
// rest because a list that reads in one order in the document and another on
// the screen is the same problem as a missing item.

/** Every numbered item in an ordered markdown list. */
const numberedItems = (body: string): string[] =>
  body
    .split(NEWLINE)
    .map((line) => /^\d+\.\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((item): item is string => item !== undefined);

/** One column of a markdown table, header row dropped. */
const tableColumn = (body: string, index: number): string[] =>
  body
    .split(NEWLINE)
    .filter((line) => line.trimStart().startsWith("|"))
    .filter((line) => !/^\|[\s|:-]+\|$/.test(line.trim()))
    .map((line) =>
      line
        .trim()
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .slice(1)
    .map((cells) => cells[index])
    .filter((cell): cell is string => cell !== undefined && cell !== "");

const compare = (
  what: string,
  documented: readonly string[],
  inPackage: readonly string[],
  floor: number,
): void => {
  // A parse that finds nothing agrees with everything, so every list is
  // floored before its contents are trusted. This is the guard that stops a
  // broken regex passing silently, the same one the trigger-key check uses.
  if (documented.length < floor) {
    fail(
      what,
      `found ${documented.length} item(s) in METHOD.md where at least ${floor} were expected; the parse is wrong, not the document`,
    );
    return;
  }
  if (documented.length !== inPackage.length) {
    fail(
      what,
      `METHOD.md lists ${documented.length} and packages/method carries ${inPackage.length}`,
    );
  }
  documented.forEach((item, index) => {
    if (inPackage[index] !== item) {
      fail(
        what,
        `position ${index + 1}: METHOD.md says "${item}" and packages/method says "${inPackage[index] ?? "nothing"}"`,
      );
    }
  });
};

// §2.2. The phase a workspace is in is stored as a number, so a list that
// reordered would renumber every cycle in the database.
compare(
  "the eight phases",
  tableColumn(section(method, "### 2.2 The eight phases", "### 2.3"), 1),
  PHASE_TITLES,
  8,
);

// §8.4. Exactly one primary cause per key result under 0.7, picked from a
// closed list in a live session.
compare(
  "the root causes",
  numberedItems(section(method, "### 8.4 Root causes", "### 8.5")),
  ROOT_CAUSES,
  8,
);

// §7.3. The five a blocker must be one of. A type in the document and not in
// the package is a type the picker will never offer.
compare(
  "the blocker taxonomy",
  tableColumn(section(method, "### 7.3 Blocker taxonomy", "### 7.4"), 0),
  BLOCKER_TYPE_DEFINITIONS.map((entry) => entry.label),
  5,
);
compare(
  "the blocker definitions",
  tableColumn(section(method, "### 7.3 Blocker taxonomy", "### 7.4"), 1),
  BLOCKER_TYPE_DEFINITIONS.map((entry) => entry.definition),
  5,
);

// §7.1. Length, frequency and purpose are what a facilitator books a calendar
// from, so all three are compared rather than the name alone.
const ritualRows = section(method, "### 7.1 The three rituals", "### 7.2");
compare("the rituals: length", tableColumn(ritualRows, 1), RITUALS.map((r) => r.length), 3);
compare("the rituals: frequency", tableColumn(ritualRows, 2), RITUALS.map((r) => r.frequency), 3);
compare("the rituals: purpose", tableColumn(ritualRows, 3), RITUALS.map((r) => r.purpose), 3);

// §8.5. Statements a room scores itself against. Wording is the whole of a
// statement, so these are compared word for word.
compare(
  "the process-health statements",
  numberedItems(section(method, "### 8.5 Process health", "### 8.6")),
  PROCESS_HEALTH_STATEMENTS,
  3,
);

// §8.7. What management is asked, in a room where the wording decides
// whether anybody answers honestly.
compare(
  "the management retro questions",
  numberedItems(section(method, "### 8.7 Management retro", "### 8.8")),
  MANAGEMENT_RETRO_QUESTIONS,
  3,
);

// §8.1. Eleven stages, in order, with the act each belongs to. The minutes
// are not compared here: §11 lists "Quarterly stage minutes" as a parameter
// in the same breath as saying the stage order cannot change, so they are a
// threshold and the registry check above already owns them.
const stageRows = section(method, "### 8.1 The stages", "### 8.2");
compare(
  "the review stages",
  tableColumn(stageRows, 1),
  REVIEW_STAGES.map((stage) => stage.title),
  11,
);
compare(
  "the review stage acts",
  tableColumn(stageRows, 2).map((act) => act.toLowerCase()),
  REVIEW_STAGES.map((stage) => stage.act),
  11,
);
compare(
  "the review stage purposes",
  tableColumn(stageRows, 4),
  REVIEW_STAGES.map((stage) => stage.purpose),
  11,
);

// §7.2. Four steps, named in bold at the head of each paragraph.
compare(
  "the weekly steps",
  [
    ...section(method, "### 7.2 The weekly check-in", "### 7.3").matchAll(
      /\*\*Step \d+\.\s*([^.*]+)\.?\*\*/g,
    ),
  ].map((match) => (match[1] ?? "").trim()),
  WEEKLY_STEPS.map((step) => step.title),
  4,
);

// §4.5. **Counted and ordered, not compared word for word, and this is the
// one weaker check in the file.**
//
// The six gates carry the same six rules in the same order in both places,
// and four of them are worded differently: the document writes full
// sentences for a reader, the package writes titles for a screen. One of the
// document's sentences is "Every key result passes the §4.2 checks", and a
// section reference is not something to put on a publish button.
//
// So this asserts that there are six and that none has been added or
// removed, which is the part a machine can judge. Whether a title still says
// what its rule says is a human's call, and the wording differences are
// recorded in STATUS.md for P7-T07 rather than quietly resolved here in
// either direction.
const documentedGates = numberedItems(
  section(method, "### 4.5 Publish gates", "### 4.6"),
);
if (documentedGates.length !== GATE_TITLES.length) {
  fail(
    "the publish gates",
    `METHOD.md §4.5 lists ${documentedGates.length} and packages/method carries ${GATE_TITLES.length}. A gate in one and not the other is a set that can be published without a rule the practice requires, or a rule nobody can satisfy.`,
  );
}

// §8.8. Three decisions, and the one-line meaning beside each. A member
// picks one of these to close an objective, so a meaning that has drifted is
// a member choosing on the strength of a sentence the practice no longer
// says.
const closeRows = section(method, "### 8.8 Keep, modify, abandon", "### 8.9");
compare(
  "the close decisions",
  tableColumn(closeRows, 0).map((label) => label.toLowerCase()),
  Object.keys(CLOSE_DECISION_MEANINGS),
  3,
);
compare(
  "the close decision meanings",
  tableColumn(closeRows, 1),
  Object.values(CLOSE_DECISION_MEANINGS),
  3,
);

// §8.6. **The diagnostic METHOD.md calls the most valuable output of the
// review**, so every diagnosis and every prescription is compared word for
// word. Getting the two lower rows backwards is the failure the section
// exists to prevent: pushing a team that already ran the rhythm, or
// rewriting objectives for a team that never met. A prescription that
// drifted into the wrong row would do exactly that, and would read as
// perfectly sensible advice.
const diagnosticRows = section(
  method,
  "### 8.6 The rhythm diagnostic",
  "### 8.7",
);
const canon = canonThresholds();
const cycleFloor = canon["sessions.diagnosticCycleScore"];
const rhythmFloor = canon["sessions.diagnosticRhythmScore"];
const producedDiagnoses = [
  // Above the cycle floor, the rhythm score is not consulted at all. The
  // second argument is deliberately the failing one, to prove it is ignored.
  rhythmDiagnostic(cycleFloor, rhythmFloor - 1, canon),
  rhythmDiagnostic(cycleFloor - 0.01, rhythmFloor, canon),
  rhythmDiagnostic(cycleFloor - 0.01, rhythmFloor - 0.01, canon),
];
compare(
  "the rhythm diagnostic: diagnoses",
  tableColumn(diagnosticRows, 1),
  producedDiagnoses.map((entry) => entry.diagnosis),
  3,
);
compare(
  "the rhythm diagnostic: prescriptions",
  tableColumn(diagnosticRows, 2),
  producedDiagnoses.map((entry) => entry.prescription),
  3,
);

// --- Report -----------------------------------------------------------------

if (problems.length > 0) {
  console.error(
    `Conformance failed. METHOD.md and packages/method disagree in ${problems.length} place(s):\n`,
  );
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  console.error(
    "\nThe document is the authority on practice. Change the package, or ask a human to change the document.",
  );
  process.exit(1);
}

const terms = Object.values(QUALITY_WORD_LISTS).reduce(
  (sum, list) => sum + list.length,
  0,
);
console.log(
  `Conformance passed. ${triggerKeys.length} trigger keys, ${CHECK_IDS.size} checks, ` +
    `${documented.size} thresholds, ${terms} word-list terms, ` +
    `${corpusEntries.length} corpus entries and ${ENUMERATIONS_CHECKED} enumerations ` +
    `agree with the documents.`,
);
