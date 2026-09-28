#!/usr/bin/env node
/**
 * `pnpm cloud:operator`: grants or revokes the cloud operator role
 * (completeness review H-21).
 *
 *   pnpm cloud:operator --email ops@example.com --granted-by founder@example.com
 *   pnpm cloud:operator --email ops@example.com --revoke --by founder@example.com
 *
 * The design says the first operator is created by the deployment and never
 * by a screen, because a screen that creates the first operator can be
 * reached by whoever gets there first. Running this needs `DATABASE_URL`,
 * which is the deployment. Both people must already have signed up.
 *
 * Exit 2 is a usage error, exit 1 a refusal.
 */
import { parseArgs } from "node:util";
import { loadEnv } from "@openokr/config";
import pg from "pg";
import {
  grantOperator,
  OperatorGrantError,
  revokeOperator,
} from "../operator/index.ts";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const fail = (line: string, code: number): never => {
  process.stderr.write(`${line}\n`);
  process.exit(code);
};

let values: {
  email?: string;
  "granted-by"?: string;
  by?: string;
  revoke?: boolean;
  note?: string;
};
try {
  ({ values } = parseArgs({
    options: {
      email: { type: "string" },
      "granted-by": { type: "string" },
      by: { type: "string" },
      revoke: { type: "boolean" },
      note: { type: "string" },
    },
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), 2);
  throw error;
}

const email = values.email;
const by = values["granted-by"] ?? values.by;
if (!email || !by) {
  fail(
    "Usage: pnpm cloud:operator --email <address> --granted-by <address> [--note <text>]\n" +
      "       pnpm cloud:operator --email <address> --revoke --by <address>",
    2,
  );
}

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

try {
  if (values.revoke) {
    const revoked = await revokeOperator(pool, {
      email: email as string,
      revokedByEmail: by as string,
    });
    write(
      revoked
        ? `${email} is no longer an operator.`
        : `${email} held no live operator grant, so nothing changed.`,
    );
  } else {
    const outcome = await grantOperator(pool, {
      email: email as string,
      grantedByEmail: by as string,
      note: values.note ?? null,
    });
    write(
      outcome === "already"
        ? `${email} is already an operator. Nothing changed.`
        : `${email} is now an operator, granted by ${by}.`,
    );
  }
} catch (error) {
  if (!(error instanceof OperatorGrantError)) {
    throw error;
  }
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
