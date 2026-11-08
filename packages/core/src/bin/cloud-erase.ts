#!/usr/bin/env node
/**
 * `pnpm cloud:erase`: erases the closed workspaces whose retention window has
 * passed (docs/design/workspace-erasure.md §7).
 *
 * **A dry run unless `--write` is given**, like the importers: it says what a real
 * run would erase, and why it would erase nothing when it would not.
 *
 * Runs as the owner role, `DATABASE_ADMIN_URL`, because only the owner role can
 * delete a workspace's audit rows and the server's role never can. Put it on the
 * deployment's schedule beside the backup: `./openokr erase` in Compose, or the
 * Helm chart's `cloud.erasure.schedule`. Nothing is erased while
 * `OPENOKR_CLOUD_CLOSURE_RETENTION_DAYS` is 0, which is the default.
 *
 *   pnpm cloud:erase                       what is due, and what a run would do
 *   pnpm cloud:erase --write               erase what is due, and finish anything started
 *   pnpm cloud:erase --id <id> --now --write
 *                                          erase one closed workspace before its window ends
 *
 * The server deletes the files and the payment customer when the claim asks it to,
 * because only the server holds those drivers, so the server must be running. A
 * run waits up to five minutes for it, and the next run carries on.
 *
 * Exit 0 when everything due was erased, or nothing was due. Exit 1 when a
 * workspace failed or is still waiting, so the log of a scheduled run shows it.
 * Exit 2 is a usage error.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { eraseWorkspaces, planErasures } from "../tenancy/erasure.ts";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const USAGE =
  "Usage: pnpm cloud:erase [--write] [--id <workspace id> --now] [--wait <seconds>]";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const known = new Set(["--write", "--id", "--now", "--wait"]);
const unknown = args.filter((arg, index) =>
  arg.startsWith("--")
    ? !known.has(arg)
    : !["--id", "--wait"].includes(args[index - 1] ?? ""),
);
const onlyId = value("--id");
const waitSeconds = Number(value("--wait") ?? 300);
if (
  unknown.length > 0 ||
  (onlyId !== undefined) !== flag("--now") ||
  (onlyId !== undefined && !/^[0-9a-f-]{36}$/i.test(onlyId)) ||
  !Number.isFinite(waitSeconds) ||
  waitSeconds < 0
) {
  process.stderr.write(`${USAGE}\n--id and --now go together.\n`);
  process.exit(2);
}

const env = loadEnv();
const pool = new pg.Pool({
  connectionString: env.DATABASE_ADMIN_URL ?? env.DATABASE_URL,
  max: 2,
});

let failed = false;
try {
  const plan = await planErasures(pool, onlyId ? { onlyId } : {});
  if (!plan.ready) {
    write(plan.reason);
    if (plan.resuming.length > 0) {
      write(
        `${plan.resuming.length} erasure(s) started earlier and not finished: ${plan.resuming
          .map((one) => one.workspaceId)
          .join(", ")}. They finish once this is fixed.`,
      );
      failed = true;
    }
  } else if (plan.due.length === 0) {
    write(
      `Retention is ${plan.retentionDays} days. No closed workspace is due, and nothing is unfinished.`,
    );
  } else {
    write(`Retention is ${plan.retentionDays} days.`);
    for (const one of plan.due) {
      write(
        `  ${one.workspaceId}  ${
          one.resuming
            ? "started earlier, not finished"
            : `closed ${one.closedAt?.toISOString() ?? "at an unknown time"}`
        }`,
      );
    }
    if (!flag("--write")) {
      write("");
      write(
        `A dry run: nothing was erased. --write erases ${plan.due.length === 1 ? "it" : `these ${plan.due.length}`}, and cannot be undone.`,
      );
    } else {
      const outcomes = await eraseWorkspaces(pool, plan, {
        ...(onlyId ? { onlyId } : {}),
        waitMs: waitSeconds * 1000,
      });
      for (const outcome of outcomes) {
        write(
          `${outcome.outcome.padEnd(8)} ${outcome.workspaceId}${
            outcome.message ? `  ${outcome.message}` : ""
          }`,
        );
        failed ||= outcome.outcome !== "erased";
      }
    }
  }
} finally {
  await pool.end();
}
process.exit(failed ? 1 : 0);
