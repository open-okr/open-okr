/**
 * `pnpm gen:contract` and `pnpm check:contract` (§14, P5-T07b).
 *
 * One script, two modes, deliberately. A generator and a checker that are
 * separate programs are two programs that can disagree about what the artifact
 * should look like, and then the check passes on a file the generator would
 * never write. Here the check *is* the generator, with the write replaced by a
 * comparison.
 *
 * Run with `--check` to compare, without it to write.
 *
 * The artifact is committed so that a change to the public surface shows up in
 * a diff a person reviews, rather than only in a build output nobody reads. That
 * is the whole reason for the drift check: not to catch a broken generator, but
 * to make a change to the contract impossible to ship silently.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildOpenApiDocument,
  diffContract,
  serialiseContract,
} from "../api/openapi.ts";

/** Repo root, from this file's own location. */
const ROOT = resolve(import.meta.dirname, "../../../..");
const ARTIFACT = resolve(ROOT, "contract/openapi.json");

const relative = (path: string): string =>
  path
    .slice(ROOT.length + 1)
    .split("\\")
    .join("/");

function write(text: string): void {
  mkdirSync(dirname(ARTIFACT), { recursive: true });
  writeFileSync(ARTIFACT, text, "utf8");
  console.log(`Wrote ${relative(ARTIFACT)}.`);
}

function check(text: string): void {
  let committed: string;
  try {
    committed = readFileSync(ARTIFACT, "utf8");
  } catch {
    console.error(
      `${relative(ARTIFACT)} is missing. Run \`pnpm gen:contract\` and commit it.`,
    );
    process.exit(1);
  }

  if (committed === text) {
    const document = JSON.parse(text) as Record<string, unknown>;
    const count = Object.keys(
      (document.paths ?? {}) as Record<string, unknown>,
    ).length;
    console.log(
      `Contract check passed. ${count} action(s) described, and the committed document agrees.`,
    );
    return;
  }

  // A byte difference is the trigger; the useful message names the actions.
  const differences = diffContract(
    JSON.parse(committed) as Record<string, unknown>,
    JSON.parse(text) as Record<string, unknown>,
  );

  console.error(`${relative(ARTIFACT)} does not match the action registry.\n`);
  if (differences.length === 0) {
    // Same structure, different bytes: formatting only. Say so rather than
    // printing an empty list and leaving somebody hunting for an action.
    console.error(
      "  The described surface is identical and only the file's formatting differs.",
    );
  }
  for (const difference of differences) {
    console.error(`  ${difference.kind}: ${difference.action}`);
    console.error(`    ${difference.detail}`);
  }
  console.error(
    "\nRun `pnpm gen:contract` and commit the result with the change that caused it.",
  );
  process.exit(1);
}

const text = serialiseContract(buildOpenApiDocument());
if (process.argv.includes("--check")) {
  check(text);
} else {
  write(text);
}
