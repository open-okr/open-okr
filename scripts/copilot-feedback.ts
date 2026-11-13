/**
 * `pnpm copilot:feedback --workspace <slug>`: the shared thumbs-down answers
 * with names and numbers replaced, for a person to turn into evaluation
 * fixtures by hand (plan 0.9.0 FB1, docs/design/copilot-feedback.md FB-D5).
 *
 * **It writes nothing and sends nothing**, and it is never run for you:
 * fixtures are committed to a public repository, so a person reads each one
 * first. Only ratings whose member chose to share the conversation appear.
 * Replacing names and numbers helps that reading and does not replace it.
 *
 * Usage: pnpm copilot:feedback --workspace <slug>
 */
import pg from "pg";
import { sharedPoorAnswers } from "../packages/core/src/copilot/feedback-fixtures.ts";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const index = process.argv.indexOf("--workspace");
const slug = index === -1 ? undefined : process.argv[index + 1];
if (!slug) {
  process.stderr.write("Usage: pnpm copilot:feedback --workspace <slug>\n");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  process.stderr.write("DATABASE_URL is not set.\n");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const workspace = (
    await pool.query<{ id: string }>(
      "select id from workspaces where slug = $1 and deleted_at is null",
      [slug],
    )
  ).rows[0];
  if (!workspace) {
    process.stderr.write(`No workspace has the slug "${slug}".\n`);
    process.exit(1);
  }

  const found = await sharedPoorAnswers(pool, workspace.id);
  if (found.length === 0) {
    write("No poor answer has been shared.");
  }
  for (const [position, candidate] of found.entries()) {
    write(`--- ${position + 1} of ${found.length}`);
    write(`model: ${candidate.model ?? "unknown"}`);
    write(`reads: ${candidate.readCount}`);
    if (candidate.note) {
      write(`note: ${candidate.note}`);
    }
    write(`question: ${candidate.question ?? ""}`);
    write("answer:");
    write(candidate.answer);
    write("");
  }
} finally {
  await pool.end();
}
