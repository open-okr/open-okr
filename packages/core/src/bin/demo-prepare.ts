#!/usr/bin/env node
/**
 * `pnpm demo:prepare`: makes a seeded workspace one a visitor can sign into
 * (P8-T13a).
 *
 * `pnpm db:seed` writes the story. This turns it into a demonstration: each of
 * the seven invented people gets an account, both agents go to sandbox, and
 * the Coach and the Champion each run once so the nudges on screen are ones
 * the product produced rather than rows something inserted.
 *
 * Refuses a workspace the demo builder did not build. The password is
 * published on purpose, because an account nobody can sign into is not a demo
 * account; `--password` sets another one.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { createAuth } from "../auth/auth.ts";
import {
  DEMO_PERSONA_PASSWORD,
  prepareDemoPersonas,
} from "../demo/personas.ts";
import { OperationError } from "../operations/errors.ts";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** `--password value`, or nothing. Exit 2 is a usage error, as everywhere. */
function passwordFlag(argv: readonly string[]): string | undefined {
  const at = argv.indexOf("--password");
  if (at === -1) {
    return undefined;
  }
  const value = argv[at + 1];
  if (!value || value.startsWith("--")) {
    process.stderr.write("--password needs a value.\n");
    process.exit(2);
  }
  return value;
}

try {
  const password = passwordFlag(process.argv.slice(2));

  // The first workspace and its founding member, the same pair `db:seed`
  // resolves. A self-hosted instance has exactly one until somebody makes a
  // second, and a demo instance never does.
  const { rows } = await pool.query<{
    workspace_id: string;
    user_id: string;
    name: string;
  }>(
    `select w.id as workspace_id, w.name, wm.user_id
       from workspaces w
       join workspace_members wm on wm.workspace_id = w.id
      where w.deleted_at is null
        and wm.deleted_at is null
        and wm.user_id is not null
      order by w.created_at, wm.created_at
      limit 1`,
  );
  const row = rows[0];

  if (!row) {
    process.stderr.write(
      "No workspace found. Open the app and finish the setup wizard first.\n",
    );
    process.exit(1);
  }

  write(`Preparing "${row.name}" as a demo.`);

  const auth = createAuth({
    pool,
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.BETTER_AUTH_URL,
    // Nothing here signs anybody in, so brute-force protection has nothing to
    // protect. Leaving it on would count these writes against the sign-in
    // window on an instance that is about to be opened to strangers.
    rateLimit: { enabled: false },
  });

  const outcome = await prepareDemoPersonas({
    pool,
    workspaceId: row.workspace_id,
    adminUserId: row.user_id,
    auth,
    ...(password ? { password } : {}),
  });

  write("");
  write(`${outcome.accountsCreated} account(s) created.`);
  write(
    `${outcome.agentsSandboxed} agent(s) set to sandbox, which commits nothing.`,
  );
  write(
    `The Coach recorded ${outcome.coachNudges} nudge(s), the Champion ${outcome.championNudges}.`,
  );
  if (outcome.ruleKeys.length > 0) {
    write(`Rules that fired: ${outcome.ruleKeys.join(", ")}`);
  }

  write("");
  write("Sign in as any of these:");
  for (const persona of outcome.personas) {
    write(`  ${persona.email.padEnd(28)} ${persona.name} — ${persona.title}`);
  }
  write("");
  write(`Password: ${password ?? DEMO_PERSONA_PASSWORD}`);
  if (!password) {
    write("Published on purpose. A demo account nobody can use is not one.");
  }

  if (outcome.notes.length > 0) {
    write("");
    write("Skipped:");
    for (const note of outcome.notes) {
      write(`  - ${note}`);
    }
  }
} catch (error) {
  if (error instanceof OperationError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
} finally {
  await pool.end();
}
