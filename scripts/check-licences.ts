#!/usr/bin/env node
/**
 * The dependency licence gate.
 *
 * OpenOKR ships under AGPL-3.0. A dependency under an incompatible licence
 * cannot be distributed with it, so this fails the build rather than letting the
 * problem reach a release. Licence changes are a human decision: when this gate
 * fires, ask, do not add to the allow list on your own.
 *
 * Reads `pnpm licenses list --json`, so it needs no extra dependency.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { isLicenceAllowed } from "../packages/config/src/licence-policy.ts";

const run = promisify(execFile);

/** Permissive and weak-copyleft licences that can ship inside an AGPL work. */
const ALLOWED = new Set([
  "0BSD",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "Artistic-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  // MIT No Attribution: MIT without the attribution clause, so it grants
  // strictly more than MIT, which is already here. Added with nodemailer in
  // P1-T09, approved 2026-08-06.
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
]);

/** Packages cleared by a human despite an unrecognised licence field. Each needs
 * a reason. Keep this list short and audited. */
const EXCEPTIONS = new Map<string, string>();

/**
 * Whole packages a human read and cleared, mirroring the workflow's
 * `allow-dependencies-licenses`.
 *
 * **Not the same list as `EXCEPTIONS`.** That one is for a package whose own
 * `license` field this script cannot recognise. This one is for a package whose
 * field is fine and which GitHub's classifier reports differently, because it
 * scans files rather than reading the field. Both are decisions a person made
 * after reading the licence text; they fail in different gates.
 *
 * Every entry needs the reason, the version read, and the date. A cleared
 * package with no reason is a hole nobody can audit.
 */
const CLEARED_PACKAGES = new Map<string, string>([
  [
    "pkg:npm/rou3",
    "Reported as MIT AND MS-PL because GitHub scans the source repository, " +
      "which carries an unrelated second licence file. The published tarball " +
      "is MIT only. Verified on 0.7.12, 2026-08-06.",
  ],
  [
    "pkg:npm/json-schema-typed",
    "Reported as BSD-2-Clause AND JSON because its LICENSE.md carries IETF " +
      "copyright notices for the JSON Schema wording it embeds, and the " +
      "classifier reads JSON as a licence identifier. The file is BSD " +
      "2-Clause throughout, with no Good-not-Evil clause. Read in full on " +
      "8.0.2, 2026-08-31.",
  ],
]);

/**
 * Identifiers this gate accepts that GitHub's dependency-review action does
 * not. `AGPL-3.0` is deprecated in SPDX in favour of the `-only` and
 * `-or-later` forms, which the action lists instead. Both spellings mean the
 * same thing, so this is a spelling difference rather than a policy one.
 */
const DEPRECATED_ALIASES = new Set(["AGPL-3.0"]);

/**
 * Fails when the two copies of the allow list disagree.
 *
 * The policy lives here and in `.github/workflows/dependency-review.yml`,
 * because the action cannot read a TypeScript file. Two copies of a security
 * policy is a policy nobody has: adding a licence to one and not the other
 * produces a gate that passes locally and fails in CI, or worse, the reverse.
 * So the disagreement is checked rather than remembered.
 */
async function checkWorkflowAgrees(): Promise<string[]> {
  const path = new URL(
    "../.github/workflows/dependency-review.yml",
    import.meta.url,
  );
  const yaml = await readFile(path, "utf8");

  // Scanned line by line rather than matched with one expression. The block is
  // a YAML folded scalar whose end is "the indentation stops", which a regular
  // expression states badly and a loop states plainly.
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^\s*allow-licenses:\s*>-\s*$/.test(line));

  if (start === -1) {
    return [
      "Could not read allow-licenses from .github/workflows/dependency-review.yml. " +
        "If the field moved, update this check: a licence gate that cannot find " +
        "the other list is not checking anything.",
    ];
  }

  const keyIndent = (lines[start] ?? "").search(/\S/);
  const collected: string[] = [];

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const indent = line.search(/\S/);
    // A blank line, a comment, or anything not indented past the key ends the
    // scalar.
    if (indent === -1 || indent <= keyIndent || line.trim().startsWith("#")) {
      break;
    }
    collected.push(line.trim());
  }

  const workflow = new Set(
    collected
      .join(" ")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  );

  if (workflow.size === 0) {
    return [
      "Read an empty allow-licenses list from the workflow, which cannot be right.",
    ];
  }

  const problems: string[] = [];

  for (const licence of workflow) {
    if (!ALLOWED.has(licence)) {
      problems.push(
        `${licence} is allowed by the workflow but not by this script.`,
      );
    }
  }
  for (const licence of ALLOWED) {
    if (!workflow.has(licence) && !DEPRECATED_ALIASES.has(licence)) {
      problems.push(
        `${licence} is allowed by this script but not by the workflow. ` +
          "Add it to allow-licenses in .github/workflows/dependency-review.yml.",
      );
    }
  }

  problems.push(...checkClearedPackagesAgree(yaml));
  return problems;
}

/**
 * The second half of the policy, which was not being compared (P5-T09b).
 *
 * `allow-dependencies-licenses` clears whole *packages* rather than licences,
 * and this script had two lists to keep in step but only ever checked one. The
 * file's own reasoning applies to both: two copies of a security policy is a
 * policy nobody has. Found when the MCP SDK's transitive `json-schema-typed`
 * failed the action while passing here, which is exactly the drift the check
 * above exists to prevent, on the field it did not cover.
 */
function checkClearedPackagesAgree(yaml: string): string[] {
  const line = yaml
    .split("\n")
    .find((candidate) =>
      /^\s*allow-dependencies-licenses:/.test(candidate),
    );
  if (!line) {
    return CLEARED_PACKAGES.size === 0
      ? []
      : [
          "This script clears packages that the workflow does not list at all. " +
            "Add allow-dependencies-licenses to " +
            ".github/workflows/dependency-review.yml.",
        ];
  }

  const workflow = new Set(
    (line.split(":").slice(1).join(":") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  );

  const problems: string[] = [];
  for (const entry of workflow) {
    if (!CLEARED_PACKAGES.has(entry)) {
      problems.push(
        `${entry} is cleared by the workflow but not by this script. ` +
          "Add it to CLEARED_PACKAGES with the reason it was read and cleared.",
      );
    }
  }
  for (const [entry] of CLEARED_PACKAGES) {
    if (!workflow.has(entry)) {
      problems.push(
        `${entry} is cleared by this script but not by the workflow. ` +
          "Add it to allow-dependencies-licenses in " +
          ".github/workflows/dependency-review.yml.",
      );
    }
  }
  return problems;
}

interface PnpmLicensePackage {
  name: string;
  versions: string[];
}

type PnpmLicensesOutput = Record<string, PnpmLicensePackage[]>;

// Windows resolves a package manager to `pnpm.cmd`, which `execFile` will not
// find without the extension, and which Node then refuses to spawn directly at
// all (the `EINVAL` guard added for CVE-2024-27980). A shell is the only way in
// on that platform. Safe here because every argument is a literal below: no
// input reaches the command line. Without this the gate exits non-zero on every
// Windows machine while passing in CI, which is a gate nobody can reach.
const { stdout } = await run("pnpm", ["licenses", "list", "--json", "--prod"], {
  maxBuffer: 32 * 1024 * 1024,
  shell: process.platform === "win32",
});

const byLicence = JSON.parse(stdout) as PnpmLicensesOutput;
const violations: string[] = [];

for (const [licence, packages] of Object.entries(byLicence)) {
  // Licence fields are SPDX expressions, not always bare identifiers:
  // "MIT OR CC0-1.0" lets us choose, "MIT AND CC-BY-4.0" binds us to both.
  if (isLicenceAllowed(licence, ALLOWED)) {
    continue;
  }

  for (const pkg of packages) {
    if (EXCEPTIONS.has(pkg.name)) {
      continue;
    }
    violations.push(`  ${pkg.name}@${pkg.versions.join(", ")} is ${licence}`);
  }
}

if (violations.length > 0) {
  process.stderr.write(
    [
      `Licence gate failed. ${violations.length} dependency licence(s) are not on the allow list:`,
      ...violations,
      "",
      "AGPL-3.0 cannot distribute every licence. Ask a human before changing this list.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Checked after the dependencies, so a real licence violation is reported
// first. This is bookkeeping between two files; that is a distributable-work
// problem.
const drift = await checkWorkflowAgrees();
if (drift.length > 0) {
  process.stderr.write(
    [
      `Licence gate failed. The allow list here and the one in the dependency-review workflow disagree:`,
      ...drift.map((problem) => `  ${problem}`),
      "",
      "Both are enforced, so a licence on one list only produces a gate that",
      "passes in one place and fails in the other.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

process.stdout.write(
  `Licence gate passed. ${Object.keys(byLicence).length} distinct licence(s) allowed, ` +
    `and the dependency-review workflow agrees.\n`,
);
