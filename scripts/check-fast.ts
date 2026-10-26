#!/usr/bin/env node
/**
 * Every static gate CI runs, in one command, in about a minute.
 *
 * The local half of the check before a push. It covers what can be decided
 * without a database or a browser: types for the packages a change affects,
 * lint, dead code, the migration and boundary rules, the air-gap and docs
 * checklists, method conformance, contract drift, licences, sign-off and the
 * changeset. The full unit suite and the browser suite run in CI, split across
 * machines, and `pnpm test:changed` covers the tests a change can reach.
 *
 * Every gate runs even after one fails, so a single run names everything to
 * fix rather than one problem per attempt. The exit code is the verdict.
 *
 * Compares against `origin/main` by default; set `CHECK_BASE` for another ref.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const BASE = process.env.CHECK_BASE ?? "origin/main";

interface Gate {
  readonly label: string;
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
}

const GATES: readonly Gate[] = [
  {
    label: "Types (affected packages)",
    args: ["turbo", "run", "typecheck", "--affected", "--concurrency=4"],
    env: { TURBO_SCM_BASE: BASE },
  },
  { label: "Lint", args: ["lint"] },
  { label: "Dead code", args: ["dead-code"] },
  { label: "Migrations and soft delete", args: ["db:lint"] },
  { label: "Architecture boundaries", args: ["check:boundaries"] },
  { label: "Air-gap checklist", args: ["check:air-gap"] },
  { label: "Documentation", args: ["check:docs"] },
  { label: "Method conformance", args: ["method:check"] },
  { label: "Contract drift", args: ["check:contract"] },
  { label: "Licences", args: ["check:licences"] },
  // CI runs these two on pull requests only, which is why a branch can look
  // green for days and fail the moment one opens. Cheap enough to run always.
  { label: "Sign-off", args: ["check:signoff", BASE, "HEAD"] },
  { label: "Changeset", args: ["check:changeset", BASE, "HEAD"] },
];

/** Enough of a failure's output to act on without scrolling a whole log. */
const TAIL_LINES = 40;

const failed: string[] = [];
const started = Date.now();

for (const gate of GATES) {
  const gateStarted = Date.now();
  let output = "";
  let passed = true;
  try {
    const result = await run("pnpm", [...gate.args], {
      env: { ...process.env, ...gate.env },
      maxBuffer: 64 * 1024 * 1024,
    });
    output = result.stdout + result.stderr;
  } catch (error) {
    passed = false;
    const { stdout = "", stderr = "" } = error as {
      stdout?: string;
      stderr?: string;
    };
    output = stdout + stderr;
  }
  const seconds = ((Date.now() - gateStarted) / 1000).toFixed(1);
  process.stdout.write(
    `${passed ? "  ok  " : "  FAIL"}  ${gate.label} (${seconds}s)\n`,
  );
  if (!passed) {
    failed.push(gate.label);
    const tail = output.trimEnd().split("\n").slice(-TAIL_LINES);
    process.stdout.write(
      `${tail.map((line) => `        ${line}`).join("\n")}\n\n`,
    );
  }
}

const total = ((Date.now() - started) / 1000).toFixed(0);
if (failed.length > 0) {
  process.stdout.write(
    `\n${failed.length} of ${GATES.length} gates failed in ${total}s: ${failed.join(", ")}\n`,
  );
  process.exit(1);
}
process.stdout.write(`\nAll ${GATES.length} gates passed in ${total}s.\n`);
