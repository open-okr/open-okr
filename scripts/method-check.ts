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
  CYCLE_CHECKS,
  isTriggerKey,
  KEY_RESULT_CHECKS,
  OBJECTIVE_CHECKS,
  THRESHOLDS,
} from "../packages/method/src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const method = read("docs", "development-plan", "METHOD.md");
const aiPlan = read("docs", "development-plan", "AI-NATIVE-PLAN.md");
const methodDesign = read("docs", "design", "p4-t00-method-package.md");
const agentDesign = read("docs", "design", "p4-t00-agent-design.md");
const qualityTests = read("packages", "method", "test", "quality.test.ts");

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

// --- 3. Corpus coverage -----------------------------------------------------

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

console.log(
  `Conformance passed. ${triggerKeys.length} trigger keys, ${CHECK_IDS.size} checks, ` +
    `${documented.size} thresholds and ${corpusEntries.length} corpus entries agree with the documents.`,
);
