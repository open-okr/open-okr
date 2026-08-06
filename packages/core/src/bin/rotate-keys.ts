#!/usr/bin/env node
/**
 * `pnpm keys:rotate`, and what the lifecycle helper runs inside the container.
 *
 * Reads the key ring from the environment, re-wraps every stored secret onto
 * the current root key, and reports. The helper puts the previous key on the
 * ring before calling this and removes it afterwards, which is what makes the
 * rotation safe to interrupt.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { parseKeyRing } from "../secrets/key-ring.ts";
import { rotateInstanceSecrets } from "../secrets/rotate.ts";

const env = loadEnv();
const current = process.env.OPENOKR_ENCRYPTION_KEY;

if (!current) {
  process.stderr.write(
    "OPENOKR_ENCRYPTION_KEY is not set. There is nothing to rotate onto.\n",
  );
  process.exit(1);
}

const previous = (process.env.OPENOKR_PREVIOUS_ENCRYPTION_KEYS ?? "")
  .split(",")
  .map((key) => key.trim())
  .filter((key) => key !== "");

const ring = parseKeyRing({ current, previous });
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

try {
  const report = await rotateInstanceSecrets(pool, ring);
  process.stdout.write(
    `Rotation complete. ${report.examined} secret(s) examined, ` +
      `${report.rewrapped} re-wrapped, ${report.current} already current.\n`,
  );
  if (report.rewrapped > 0) {
    process.stdout.write(
      "The previous key is no longer needed to read these secrets.\n",
    );
  }
} finally {
  await pool.end();
}
