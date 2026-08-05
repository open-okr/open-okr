#!/usr/bin/env node
/**
 * The commit sign-off gate (Developer Certificate of Origin).
 *
 * Every commit must carry `Signed-off-by: Name <email>`, which is how a
 * contributor states they have the right to contribute the code. CONTRIBUTING.md
 * explains it to humans; this enforces it.
 *
 * Usage: check-signoff [base-ref] [head-ref]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const [base = "origin/main", head = "HEAD"] = process.argv.slice(2);

const SIGN_OFF = /^Signed-off-by: .+ <[^>]+@[^>]+>$/m;

// Unit and record separators keep multi-line commit bodies unambiguous.
const FIELD = "\u001f";
const RECORD = "\u001e";

const { stdout } = await run("git", [
  "log",
  `${base}..${head}`,
  `--format=%H${FIELD}%s${FIELD}%b${RECORD}`,
  "--no-merges",
]);

const commits = stdout
  .split(RECORD)
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0)
  .map((entry) => {
    const [hash = "", subject = "", body = ""] = entry.split(FIELD);
    return { hash, subject, body };
  });

const unsigned = commits.filter((commit) => !SIGN_OFF.test(commit.body));

if (unsigned.length > 0) {
  process.stderr.write(
    [
      `${unsigned.length} commit(s) are missing a sign-off:`,
      ...unsigned.map((commit) => `  ${commit.hash.slice(0, 8)} ${commit.subject}`),
      "",
      "Fix with:  git commit --amend -s              (one commit)",
      `           git rebase --signoff ${base}   (several)`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

process.stdout.write(`Sign-off gate passed. ${commits.length} commit(s) checked.\n`);
