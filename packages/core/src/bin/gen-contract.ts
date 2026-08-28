/**
 * `pnpm gen:contract` and `pnpm check:contract` (§14, P5-T07b, P5-T07c-a).
 *
 * One script, two modes, deliberately. A generator and a checker that are
 * separate programs are two programs that can disagree about what the artifact
 * should look like, and then the check passes on a file the generator would
 * never write. Here the check *is* the generator, with the write replaced by a
 * comparison.
 *
 * Run with `--check` to compare, without it to write.
 *
 * The artifacts are committed so that a change to the public surface shows up in
 * a diff a person reviews, rather than only in a build output nobody reads. That
 * is the whole reason for the drift check: not to catch a broken generator, but
 * to make a change to the contract impossible to ship silently.
 *
 * Two artifacts now, generated in the same run so they cannot describe different
 * registries: the OpenAPI document, and the command list the `okr` tool reads.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildCliContract,
  type CliContract,
  diffCliContract,
} from "../api/cli-contract.ts";
import {
  buildOpenApiDocument,
  diffContract,
  type JsonObject,
  serialiseContract,
} from "../api/openapi.ts";

/** Repo root, from this file's own location. */
const ROOT = resolve(import.meta.dirname, "../../../..");
const OPENAPI = resolve(ROOT, "contract/openapi.json");
const CLI = resolve(ROOT, "contract/cli.json");

const relative = (path: string): string =>
  path
    .slice(ROOT.length + 1)
    .split("\\")
    .join("/");

/** One artifact: how to build it, and how to describe what moved. */
interface Artifact {
  readonly file: string;
  readonly text: string;
  /** What to print when it matches. */
  readonly summary: (text: string) => string;
  /** Named differences, most useful first. */
  readonly differences: (
    committed: string,
    fresh: string,
  ) => readonly { kind: string; subject: string; detail: string }[];
}

const artifacts: readonly Artifact[] = [
  {
    file: OPENAPI,
    text: serialiseContract(buildOpenApiDocument()),
    summary: (text) => {
      const document = JSON.parse(text) as JsonObject;
      const count = Object.keys((document.paths ?? {}) as JsonObject).length;
      return `${count} action(s) described`;
    },
    differences: (committed, fresh) =>
      diffContract(
        JSON.parse(committed) as JsonObject,
        JSON.parse(fresh) as JsonObject,
      ).map((difference) => ({
        kind: difference.kind,
        subject: difference.action,
        detail: difference.detail,
      })),
  },
  {
    file: CLI,
    text: `${JSON.stringify(buildCliContract(), null, 2)}\n`,
    summary: (text) =>
      `${(JSON.parse(text) as CliContract).commands.length} command(s) listed`,
    differences: (committed, fresh) =>
      diffCliContract(
        JSON.parse(committed) as CliContract,
        JSON.parse(fresh) as CliContract,
      ).map((difference) => ({
        kind: difference.kind,
        subject: difference.command,
        detail: difference.detail,
      })),
  },
];

function write(): void {
  for (const artifact of artifacts) {
    mkdirSync(dirname(artifact.file), { recursive: true });
    writeFileSync(artifact.file, artifact.text, "utf8");
    console.log(`Wrote ${relative(artifact.file)}.`);
  }
}

function check(): void {
  let failed = false;

  for (const artifact of artifacts) {
    let committed: string;
    try {
      committed = readFileSync(artifact.file, "utf8");
    } catch {
      console.error(
        `${relative(artifact.file)} is missing. Run \`pnpm gen:contract\` and commit it.`,
      );
      failed = true;
      continue;
    }

    if (committed === artifact.text) {
      console.log(
        `${relative(artifact.file)}: ${artifact.summary(artifact.text)}, and the committed file agrees.`,
      );
      continue;
    }

    failed = true;
    // A byte difference is the trigger; the useful message names what moved.
    const differences = artifact.differences(committed, artifact.text);
    console.error(
      `\n${relative(artifact.file)} does not match the action registry.`,
    );
    if (differences.length === 0) {
      // Same structure, different bytes: formatting only. Say so rather than
      // printing an empty list and leaving somebody hunting for an action.
      console.error(
        "  What it describes is identical and only the file's formatting differs.",
      );
    }
    for (const difference of differences) {
      console.error(`  ${difference.kind}: ${difference.subject}`);
      console.error(`    ${difference.detail}`);
    }
  }

  if (failed) {
    console.error(
      "\nRun `pnpm gen:contract` and commit the result with the change that caused it.",
    );
    process.exit(1);
  }
  console.log("Contract check passed.");
}

if (process.argv.includes("--check")) {
  check();
} else {
  write();
}
