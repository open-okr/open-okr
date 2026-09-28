#!/usr/bin/env node
/**
 * `pnpm uat:personas`: gives a fresh workspace the seven Northwind people as
 * members who can sign in, for the manual acceptance test.
 *
 * Run it after the setup wizard (UAT module M02) and before M04. It creates
 * the people and nothing else: titles, managers, spaces and goals are still
 * built through the screens, because those are what the workbook tests.
 *
 *   pnpm uat:personas --inbox qa@example.com [--password <12+ characters>]
 *
 * Refuses a workspace that has anybody in it besides its founder and these
 * seven. Running it twice changes nothing.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { createAuth } from "../auth/auth.ts";
import {
  inboxProblem,
  passwordProblem,
  prepareUatPersonas,
  UAT_PERSONA_PASSWORD,
} from "../demo/uat-personas.ts";
import { OperationError } from "../operations/errors.ts";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** Exit 2 is a usage error decided here, before anything is sent. */
function usage(problem: string): never {
  process.stderr.write(`${problem}\n\n`);
  process.stderr.write(
    [
      "Usage: pnpm uat:personas --inbox <address> [--password <value>]",
      "",
      "  --inbox <address>    The mailbox every persona's mail reaches, as",
      "                       plus-addresses: qa@example.com gives",
      "                       qa+priya@example.com. Required.",
      `  --password <value>   Shared by all seven. Default ${UAT_PERSONA_PASSWORD}.`,
      "",
    ].join("\n"),
  );
  process.exit(2);
}

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) {
    return undefined;
  }
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) {
    usage(`--${name} needs a value.`);
  }
  return value;
}

const inbox = flag("inbox");
if (!inbox) {
  usage("--inbox is required.");
}
const password = flag("password");
const problem =
  inboxProblem(inbox) ?? (password ? passwordProblem(password) : null);
if (problem) {
  usage(problem);
}

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

try {
  // The first workspace and its founding member, the same pair `db:seed`
  // resolves. A self-hosted instance has exactly one until somebody makes a
  // second.
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

  write(`Adding the UAT personas to "${row.name}".`);

  const auth = createAuth({
    pool,
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.BETTER_AUTH_URL,
    // Nothing here signs anybody in, so the brute-force window has nothing to
    // protect, and seven account writes would otherwise count against it.
    rateLimit: { enabled: false },
  });

  const outcome = await prepareUatPersonas({
    pool,
    workspaceId: row.workspace_id,
    adminUserId: row.user_id,
    auth,
    inbox,
    ...(password ? { password } : {}),
  });

  write(`${outcome.joined} persona(s) joined through a workspace invitation.`);
  write("");
  write("Sign in as any of these:");
  for (const persona of outcome.personas) {
    const note = persona.joined ? "" : "  (already a member)";
    write(`  ${persona.email.padEnd(36)} ${persona.name}${note}`);
  }
  write("");
  write(`Password: ${outcome.password}`);
  write(
    "Titles, managers and spaces are left empty on purpose. UAT modules M06 and M07 set them.",
  );
} catch (error) {
  if (error instanceof OperationError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
} finally {
  await pool.end();
}
