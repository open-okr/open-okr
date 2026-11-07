#!/usr/bin/env node
/**
 * `pnpm cloud:adopt`: gives every live workspace a tenant record now.
 *
 * The scheduler does this every hour with the cloud flag on. This is for an operator
 * who wants it now, and for an instance running with `OPENOKR_SCHEDULER=off`. A
 * second run changes nothing.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { adoptWorkspaces } from "../tenancy/adopt.ts";

const pool = new pg.Pool({ connectionString: loadEnv().DATABASE_URL });
try {
  const adopted = await adoptWorkspaces(pool);
  process.stdout.write(`Adopted ${adopted} workspace(s).\n`);
} finally {
  await pool.end();
}
