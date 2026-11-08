/**
 * Erasing a closed workspace once its retention window has passed
 * (docs/design/workspace-erasure.md §4 and §5).
 *
 * **It runs as the owner role, from a command on the deployment's schedule.** The
 * server's role has no DELETE on `audit_events`, and keeps none: the one exception
 * the audit trigger makes is for a workspace whose tenant says erasure has started,
 * and only the owner role can act on it. A deployment that never schedules the
 * command deletes nothing, and the operator console counts what is overdue.
 *
 * **Each workspace is one data-change script, `erase-workspace-<id>`,** so the
 * runner gives it batches, a cursor that survives a crash, and a ledger row that
 * outlives the workspace. The phases:
 *
 * | Phase | What happens |
 * |---|---|
 * | claim | `tenants.erasing_at` and `workspaces.deleted_at` are set, and two outbox rows ask the server to delete the files and the payment customer |
 * | wait | Until the server has done both. Only the server holds the storage and billing drivers |
 * | accounts | One person per batch: an account with no other workspace and no operator grant is deleted |
 * | sso | The SAML rows Better Auth derived from this workspace's connections |
 * | rows | Every table holding `workspace_id`, children first, a thousand rows at a time |
 * | last | The audit chain's head is recorded, its rows deleted, then the tenant and the workspace. Every table is counted, and the batch rolls back if anything is left |
 * | receipt | `workspace.erased` on the instance chain, with nothing personal in it |
 */
import { createHash } from "node:crypto";
import {
  type DataChangeClient,
  DataChangeError,
  type DataChangeScript,
  enqueueOutbox,
  instanceAuditEvents,
  runDataChanges,
  withInstanceAdmin,
} from "@openokr/db";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { appendInstanceAuditInTx } from "../audit/instance-chain.ts";
import { resolveCloudTenancy } from "./settings.ts";

/** Asks the server to delete everything stored under the workspace's prefix. */
export const ERASE_FILES_TOPIC = "workspace.eraseFiles";
/** Asks the server to delete the workspace's customer at the payment provider. */
export const ERASE_CUSTOMER_TOPIC = "billing.deleteCustomer";

const SCRIPT_PREFIX = "erase-workspace-";
const BATCH = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Erased last, by hand, in this order: the trigger reads the tenant. */
const LAST_TABLES = new Set(["audit_events", "tenants"]);

interface TablePlan {
  readonly name: string;
  /** Columns referencing the same table with no cascade, so leaves go first. */
  readonly selfRefs: readonly {
    readonly column: string;
    readonly ref: string;
  }[];
}

interface Cursor {
  readonly phase: "wait" | "accounts" | "sso" | "rows" | "last" | "receipt";
  readonly slugSha256: string;
  readonly closedAt: string | null;
  readonly claimedAt: string;
  readonly retentionDays: number;
  readonly windowSkipped: boolean;
  readonly waitKeys: readonly string[];
  readonly rows: number;
  readonly accounts: number;
  readonly lastUserId?: string;
  readonly tables?: readonly TablePlan[];
  readonly tableIndex?: number;
  readonly auditHead?: {
    readonly seq: number | null;
    readonly hash: string | null;
  };
}

/** Thrown when the server has not yet done what the claim asked of it. */
class StillWaiting extends Error {}

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

async function setting(
  client: DataChangeClient,
  name: string,
  value: string,
): Promise<void> {
  await client.query("select set_config($1, $2, true)", [name, value]);
}

const asTenant = (client: DataChangeClient, workspaceId: string) =>
  setting(client, "app.workspace_id", workspaceId);

/**
 * Every table holding `workspace_id`, children before the tables they point at.
 * Read from the schema each time, so a table added next year is erased without
 * anybody remembering it.
 */
async function tablesInOrder(client: DataChangeClient): Promise<TablePlan[]> {
  const { rows: tables } = await client.query<{ name: string }>(
    `select table_name as name from information_schema.columns
      where table_schema = 'public' and column_name = 'workspace_id'
      order by table_name`,
  );
  const names = new Set(
    tables.map((row) => row.name).filter((name) => !LAST_TABLES.has(name)),
  );
  const { rows: keys } = await client.query<{
    child: string;
    parent: string;
    action: string;
    columns: string[];
    refs: string[];
  }>(
    `select c.conrelid::regclass::text as child,
            c.confrelid::regclass::text as parent,
            c.confdeltype::text as action,
            array(select a.attname::text from unnest(c.conkey) k
                    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) as columns,
            array(select a.attname::text from unnest(c.confkey) k
                    join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k) as refs
       from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace`,
  );
  const children = new Map([...names].map((name) => [name, new Set<string>()]));
  const selfRefs = new Map<string, { column: string; ref: string }[]>();
  for (const key of keys) {
    if (!names.has(key.child) || !names.has(key.parent)) {
      continue;
    }
    if (key.child === key.parent) {
      // A cascade or a set-null looks after itself. Anything else needs the
      // rows nothing points at deleted first.
      if (
        key.action !== "c" &&
        key.action !== "n" &&
        key.action !== "d" &&
        key.columns.length === 1 &&
        key.refs.length === 1
      ) {
        selfRefs.set(key.child, [
          ...(selfRefs.get(key.child) ?? []),
          { column: key.columns[0] as string, ref: key.refs[0] as string },
        ]);
      }
      continue;
    }
    children.get(key.parent)?.add(key.child);
  }
  const ordered: string[] = [];
  const left = new Set(names);
  while (left.size > 0) {
    const ready = [...left].filter((name) =>
      [...(children.get(name) ?? [])].every((child) => !left.has(child)),
    );
    // A cycle through cascades is broken by name. One that blocks a delete is
    // found by the count in the last phase, which rolls the run back.
    const next = ready.length > 0 ? ready : [[...left].sort()[0] as string];
    for (const name of next.sort()) {
      ordered.push(name);
      left.delete(name);
    }
  }
  return ordered.map((name) => ({
    name,
    selfRefs: selfRefs.get(name) ?? [],
  }));
}

async function countLeft(
  client: DataChangeClient,
  workspaceId: string,
): Promise<string[]> {
  const { rows: tables } = await client.query<{ name: string }>(
    `select table_name as name from information_schema.columns
      where table_schema = 'public' and column_name = 'workspace_id'
      order by table_name`,
  );
  const left: string[] = [];
  for (const { name } of tables) {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from ${quote(name)} where workspace_id = $1`,
      [workspaceId],
    );
    if ((rows[0]?.n ?? 0) > 0) {
      left.push(`${name} (${rows[0]?.n})`);
    }
  }
  const { rows } = await client.query<{ n: number }>(
    "select count(*)::int as n from workspaces where id = $1",
    [workspaceId],
  );
  if ((rows[0]?.n ?? 0) > 0) {
    left.push("workspaces (1)");
  }
  return left;
}

interface ErasureOptions {
  /** True for `--id --now`: the window was not waited out. */
  readonly windowSkipped: boolean;
  readonly retentionDays: number;
  /** How long to wait for the server's half before giving up for this run. */
  readonly waitMs: number;
  /** Injected so a test does not sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** A test's way of stopping a run after this many batches, to prove it resumes. */
  readonly interruptAfter?: number;
}

/** The script that erases one workspace. Built per run, so the wait is per run. */
function erasureScript(
  workspaceId: string,
  options: ErasureOptions,
): DataChangeScript {
  const deadline = Date.now() + options.waitMs;
  let batches = 0;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const next = (cursor: Cursor, rowsChanged = 0) => ({
    done: false,
    cursor: JSON.stringify(cursor),
    rowsChanged,
  });

  return {
    name: `${SCRIPT_PREFIX}${workspaceId}`,
    summary: `Erases closed workspace ${workspaceId} (docs/design/workspace-erasure.md).`,
    expects: [
      {
        table: "tenants",
        column: "erasing_at",
        dataType: "timestamp with time zone",
      },
      {
        table: "workspaces",
        column: "deleted_at",
        dataType: "timestamp with time zone",
      },
    ],
    async runBatch(client, raw) {
      batches += 1;
      if (
        options.interruptAfter !== undefined &&
        batches > options.interruptAfter
      ) {
        throw new Error("Interrupted, as the test asked.");
      }
      await asTenant(client, workspaceId);
      if (raw === null) {
        return next(await claim(client, workspaceId, options));
      }
      const cursor = JSON.parse(raw) as Cursor;

      if (cursor.phase === "wait") {
        const { rows } = await client.query<{
          key: string;
          delivered: boolean;
          dead: boolean;
          error: string | null;
        }>(
          `select idempotency_key as key, delivered_at is not null as delivered,
                  dead_lettered_at is not null as dead, last_error as error
             from outbox where idempotency_key = any($1)`,
          [cursor.waitKeys],
        );
        // A row that is gone was delivered and later purged: the claim wrote both.
        const dead = rows.filter((row) => row.dead);
        if (dead.length > 0) {
          if (Date.now() > deadline) {
            throw new Error(
              `The server could not finish erasing ${workspaceId}: ${dead
                .map((row) => `${row.key}: ${row.error ?? "no reason given"}`)
                .join("; ")}`,
            );
          }
          // Asked again, in case whatever stopped it has been fixed since.
          // openokr:allow-mutation: the erasure's own outbox rows.
          await client.query(
            `update outbox set dead_lettered_at = null, attempts = 0,
                    available_at = now(), last_error = null
              where idempotency_key = any($1) and dead_lettered_at is not null`,
            [dead.map((row) => row.key)],
          );
          await sleep(2000);
          return next(cursor);
        }
        if (rows.some((row) => !row.delivered)) {
          if (Date.now() > deadline) {
            throw new StillWaiting(
              `Waiting for the server to delete ${workspaceId}'s files and payment customer. The next run carries on.`,
            );
          }
          await sleep(2000);
          return next(cursor);
        }
        return next({ ...cursor, phase: "accounts" });
      }

      if (cursor.phase === "accounts") {
        const { rows } = await client.query<{ id: string }>(
          `select distinct user_id as id from workspace_members
            where workspace_id = $1 and user_id is not null and user_id > $2
            order by user_id limit 1`,
          [workspaceId, cursor.lastUserId ?? ""],
        );
        const userId = rows[0]?.id;
        if (!userId) {
          return next({ ...cursor, phase: "sso" });
        }
        // Their memberships elsewhere, which only their own setting can see.
        await setting(client, "app.workspace_id", "");
        await setting(client, "app.user_id", userId);
        const elsewhere = await client.query(
          `select 1 from workspace_members
            where user_id = $1 and workspace_id <> $2 and deleted_at is null
            limit 1`,
          [userId, workspaceId],
        );
        await setting(client, "app.user_id", "");
        await setting(client, "app.instance_admin", "on");
        // An operator, now or once, keeps their account: the instance chain and
        // other workspaces' audit rows name them.
        const operator = await client.query(
          `select 1 from instance_operators
            where user_id = $1 or granted_by_user_id = $1 limit 1`,
          [userId],
        );
        await setting(client, "app.instance_admin", "");
        await asTenant(client, workspaceId);
        let deleted = 0;
        if (elsewhere.rows.length === 0 && operator.rows.length === 0) {
          // openokr:allow-mutation: an instance table outside the pipeline, as
          // Better Auth's own deletes are. Sessions, sign-in methods and second
          // factors go with it by their own keys.
          await client.query("delete from users where id = $1", [userId]);
          deleted = 1;
        }
        return next(
          {
            ...cursor,
            lastUserId: userId,
            accounts: cursor.accounts + deleted,
          },
          deleted,
        );
      }

      if (cursor.phase === "sso") {
        // openokr:allow-mutation: Better Auth's table, derived from this
        // workspace's connections, which go in the next phase.
        await client.query(
          `delete from sso_providers where provider_id in
             (select provider_id from sso_connections where workspace_id = $1)`,
          [workspaceId],
        );
        return next({
          ...cursor,
          phase: "rows",
          tables: await tablesInOrder(client),
          tableIndex: 0,
        });
      }

      if (cursor.phase === "rows") {
        const tables = cursor.tables ?? [];
        const index = cursor.tableIndex ?? 0;
        const table = tables[index];
        if (!table) {
          return next({ ...cursor, phase: "last" });
        }
        const leaves = table.selfRefs
          .map(
            (ref) =>
              ` and not exists (select 1 from ${quote(table.name)} x where x.${quote(ref.column)} = t.${quote(ref.ref)})`,
          )
          .join("");
        // openokr:allow-mutation: erasure, batched by the data-change runner.
        const { rows } = await client.query<{ n: number }>(
          `with gone as (
             delete from ${quote(table.name)} where ctid in (
               select t.ctid from ${quote(table.name)} t
                where t.workspace_id = $1${leaves} limit ${BATCH})
             returning 1)
           select count(*)::int as n from gone`,
          [workspaceId],
        );
        const deleted = rows[0]?.n ?? 0;
        return next(
          {
            ...cursor,
            rows: cursor.rows + deleted,
            tableIndex: deleted === 0 ? index + 1 : index,
          },
          deleted,
        );
      }

      if (cursor.phase === "last") {
        const { rows: head } = await client.query<{
          seq: string | null;
          hash: string | null;
        }>(
          `select seq::text as seq, row_hash as hash from audit_events
            where workspace_id = $1 and seq is not null
            order by seq desc limit 1`,
          [workspaceId],
        );
        // openokr:allow-mutation: the one delete the audit trigger permits, for
        // a tenant whose erasure has started.
        const audit = await client.query<{ n: number }>(
          `with gone as (delete from audit_events where workspace_id = $1 returning 1)
           select count(*)::int as n from gone`,
          [workspaceId],
        );
        // openokr:allow-mutation: erasure's last step, after the audit rows,
        // because the trigger that permits those reads this tenant.
        await client.query("delete from tenants where workspace_id = $1", [
          workspaceId,
        ]);
        // openokr:allow-mutation: the workspace itself. Its keys cascade to
        // anything the batches above did not reach, and the count below fails
        // the step if anything was missed.
        await client.query("delete from workspaces where id = $1", [
          workspaceId,
        ]);
        const left = await countLeft(client, workspaceId);
        if (left.length > 0) {
          throw new Error(
            `Erasing ${workspaceId} left rows behind, so nothing in this step was kept: ${left.join(", ")}`,
          );
        }
        const deleted = (audit.rows[0]?.n ?? 0) + 2;
        return next(
          {
            ...cursor,
            phase: "receipt",
            rows: cursor.rows + deleted,
            auditHead: {
              seq: head[0]?.seq ? Number(head[0].seq) : null,
              hash: head[0]?.hash ?? null,
            },
          },
          deleted,
        );
      }

      // The receipt: what a written confirmation is written from. Nothing in it
      // names a person.
      await setting(client, "app.instance_admin", "on");
      await appendInstanceAuditInTx(drizzle(client as unknown as PoolClient), {
        action: "workspace.erased",
        payload: {
          workspaceId,
          slugSha256: cursor.slugSha256,
          closedAt: cursor.closedAt,
          claimedAt: cursor.claimedAt,
          erasedAt: new Date().toISOString(),
          retentionDays: cursor.retentionDays,
          windowSkipped: cursor.windowSkipped,
          rows: cursor.rows,
          accounts: cursor.accounts,
          auditHead: cursor.auditHead ?? null,
        },
      });
      return { done: true, rowsChanged: 1 };
    },
  };
}

/** The first batch: from here on the workspace is gone to everybody. */
async function claim(
  client: DataChangeClient,
  workspaceId: string,
  options: ErasureOptions,
): Promise<Cursor> {
  const { rows } = await client.query<{
    state: string;
    closed_at: Date | null;
    slug: string;
  }>(
    `select t.state, t.closed_at, w.slug
       from tenants t join workspaces w on w.id = t.workspace_id
      where t.workspace_id = $1`,
    [workspaceId],
  );
  const tenant = rows[0];
  if (tenant?.state !== "closed") {
    throw new Error(`${workspaceId} is not closed, so it is not erased.`);
  }
  // openokr:allow-mutation: the claim. The owner role, under the tenant floor.
  await client.query(
    "update tenants set erasing_at = now(), updated_at = now() where workspace_id = $1",
    [workspaceId],
  );
  // openokr:allow-mutation: the claim, as above. Every member and every job
  // loses the workspace at once through the soft-delete scope.
  await client.query(
    "update workspaces set deleted_at = coalesce(deleted_at, now()) where id = $1",
    [workspaceId],
  );
  const { rows: accounts } = await client.query<{
    provider: string;
    customer_ref: string;
  }>(
    "select provider, customer_ref from billing_accounts where workspace_id = $1",
    [workspaceId],
  );
  const db = drizzle(client as unknown as PoolClient);
  const waitKeys = [`${ERASE_FILES_TOPIC}:${workspaceId}`];
  await enqueueOutbox(db, {
    topic: ERASE_FILES_TOPIC,
    payload: { workspaceId },
    idempotencyKey: `${ERASE_FILES_TOPIC}:${workspaceId}`,
  });
  for (const account of accounts) {
    const key = `${ERASE_CUSTOMER_TOPIC}:${workspaceId}:${account.customer_ref}`;
    await enqueueOutbox(db, {
      topic: ERASE_CUSTOMER_TOPIC,
      payload: {
        workspaceId,
        provider: account.provider,
        customerRef: account.customer_ref,
      },
      idempotencyKey: key,
    });
    waitKeys.push(key);
  }
  await setting(client, "app.instance_admin", "on");
  await appendInstanceAuditInTx(db, {
    action: "workspace.erasure_started",
    payload: { workspaceId, windowSkipped: options.windowSkipped },
  });
  await setting(client, "app.instance_admin", "");
  return {
    phase: "wait",
    slugSha256: createHash("sha256").update(tenant.slug).digest("hex"),
    closedAt: tenant.closed_at ? tenant.closed_at.toISOString() : null,
    claimedAt: new Date().toISOString(),
    retentionDays: options.retentionDays,
    windowSkipped: options.windowSkipped,
    waitKeys,
    rows: 0,
    accounts: 0,
  };
}

interface ErasureCandidate {
  readonly workspaceId: string;
  readonly closedAt: Date | null;
  /** Started on an earlier run and not finished. */
  readonly resuming: boolean;
}

export type ErasurePlan =
  | {
      readonly ready: false;
      readonly reason: string;
      readonly resuming: readonly ErasureCandidate[];
    }
  | {
      readonly ready: true;
      readonly retentionDays: number;
      readonly due: readonly ErasureCandidate[];
    };

/**
 * What a run would erase, or why it would erase nothing (§4, phase 0). Unfinished
 * erasures are always named, because one that started is finished whatever the
 * settings say now.
 */
export async function planErasures(
  pool: Pool,
  options: {
    readonly now?: Date;
    /** `--id --now`: this one closed workspace, whatever its window. */
    readonly onlyId?: string;
  } = {},
): Promise<ErasurePlan> {
  const now = options.now ?? new Date();
  const client = await pool.connect();
  try {
    const resuming = await unfinished(client);
    const { rows: grant } = await client.query<{ ok: boolean }>(
      "select has_table_privilege('audit_events', 'DELETE') as ok",
    );
    if (!grant[0]?.ok) {
      return {
        ready: false,
        reason:
          "This connection cannot delete audit rows, so it cannot erase anything. Run it with the owner role, DATABASE_ADMIN_URL.",
        resuming,
      };
    }
    const cloud = await resolveCloudTenancy(pool);
    if (!cloud.enabled) {
      return {
        ready: false,
        reason: "This instance is not a cloud.",
        resuming,
      };
    }
    if (!options.onlyId && cloud.closureRetentionDays <= 0) {
      return {
        ready: false,
        reason:
          "Retention is 0, which means never erase. Set OPENOKR_CLOUD_CLOSURE_RETENTION_DAYS to turn erasure on.",
        resuming,
      };
    }
    const cutoff = new Date(
      now.getTime() - cloud.closureRetentionDays * DAY_MS,
    );
    await client.query("begin");
    try {
      await setting(client, "app.instance_admin", "on");
      const { rows } = await client.query<{
        workspace_id: string;
        closed_at: Date | null;
      }>(
        `select workspace_id, closed_at from tenants
          where state = 'closed' and erasing_at is null and deleted_at is null
            and ($1::uuid is null and closed_at <= $2 or workspace_id = $1::uuid)
          order by closed_at`,
        [options.onlyId ?? null, cutoff],
      );
      await client.query("commit");
      if (
        options.onlyId &&
        rows.length === 0 &&
        !resuming.some((one) => one.workspaceId === options.onlyId)
      ) {
        return {
          ready: false,
          reason: `${options.onlyId} is not a closed workspace, so it is not erased.`,
          resuming,
        };
      }
      return {
        ready: true,
        retentionDays: cloud.closureRetentionDays,
        due: [
          ...resuming.filter(
            (one) => !options.onlyId || one.workspaceId === options.onlyId,
          ),
          ...rows.map((row) => ({
            workspaceId: row.workspace_id,
            closedAt: row.closed_at,
            resuming: false,
          })),
        ],
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    client.release();
  }
}

async function unfinished(client: PoolClient): Promise<ErasureCandidate[]> {
  const { rows: ledger } = await client.query<{ exists: boolean }>(
    "select to_regclass('_data_changes') is not null as exists",
  );
  if (!ledger[0]?.exists) {
    return [];
  }
  const { rows } = await client.query<{ name: string }>(
    `select name from _data_changes
      where name like $1 and completed_at is null order by started_at`,
    [`${SCRIPT_PREFIX}%`],
  );
  return rows.map((row) => ({
    workspaceId: row.name.slice(SCRIPT_PREFIX.length),
    closedAt: null,
    resuming: true,
  }));
}

export interface ErasureOutcome {
  readonly workspaceId: string;
  readonly outcome: "erased" | "waiting" | "failed";
  readonly message?: string;
}

/**
 * Erases what `planErasures` named, one workspace at a time, oldest first. A
 * workspace that fails stops there and keeps its progress, and the rest still run.
 */
export async function eraseWorkspaces(
  pool: Pool,
  plan: Extract<ErasurePlan, { ready: true }>,
  options: {
    readonly onlyId?: string;
    readonly now?: Date;
    readonly waitMs?: number;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly interruptAfter?: number;
  } = {},
): Promise<ErasureOutcome[]> {
  const now = options.now ?? new Date();
  const outcomes: ErasureOutcome[] = [];
  const client = await pool.connect();
  try {
    for (const candidate of plan.due) {
      const windowSkipped =
        options.onlyId === candidate.workspaceId &&
        (plan.retentionDays <= 0 ||
          (candidate.closedAt !== null &&
            candidate.closedAt.getTime() >
              now.getTime() - plan.retentionDays * DAY_MS));
      try {
        await runDataChanges(client, {
          scripts: [
            erasureScript(candidate.workspaceId, {
              windowSkipped,
              retentionDays: plan.retentionDays,
              waitMs: options.waitMs ?? 5 * 60 * 1000,
              ...(options.sleep ? { sleep: options.sleep } : {}),
              ...(options.interruptAfter === undefined
                ? {}
                : { interruptAfter: options.interruptAfter }),
            }),
          ],
        });
        outcomes.push({
          workspaceId: candidate.workspaceId,
          outcome: "erased",
        });
      } catch (error) {
        const cause = error instanceof DataChangeError ? error.cause : error;
        outcomes.push({
          workspaceId: candidate.workspaceId,
          outcome: cause instanceof StillWaiting ? "waiting" : "failed",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  } finally {
    client.release();
  }
  return outcomes;
}

/**
 * Every erasure's receipt, oldest first: what a written confirmation of deletion is
 * written from (docs/design/workspace-erasure.md §7).
 */
export async function listErasureReceipts(
  pool: Pool,
): Promise<readonly { readonly at: Date; readonly payload: unknown }[]> {
  return withInstanceAdmin(drizzle(pool), (tx) =>
    tx
      .select({
        at: instanceAuditEvents.at,
        payload: instanceAuditEvents.payload,
      })
      .from(instanceAuditEvents)
      .where(eq(instanceAuditEvents.action, "workspace.erased"))
      .orderBy(asc(instanceAuditEvents.seq)),
  );
}
