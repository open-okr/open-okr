import { join } from "node:path";
import { workerDb } from "@openokr/test-support/db";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DataChangeBatchResult,
  type DataChangeClient,
  DataChangeError,
  type DataChangeScript,
  runDataChanges,
} from "../src/data-change.ts";
import { backfillMemberTimezone } from "../src/data-changes/0001_backfill_member_timezone.ts";
import { seedChampionAgent } from "../src/data-changes/0006_seed_champion_agent.ts";
import { backfillBlockerGoal } from "../src/data-changes/0008_backfill_blocker_goal.ts";
import { bindAgentsToSpacelessItems } from "../src/data-changes/0009_bind_agents_to_spaceless_items.ts";
import { runMigrations } from "../src/migrate.ts";

/**
 * The data-change runner (P2-T12 test plan). Batched, resumable, idempotent
 * by ledger, and frozen against a schema that has moved on since a script
 * was written.
 */

let scratchDb: string;
let client: pg.Client;

const connectScratch = async (): Promise<pg.Client> => {
  const wb = await workerDb();
  const admin = wb.admin.options;
  const scratch = new pg.Client({
    host: admin.host,
    port: admin.port,
    user: admin.user,
    password: admin.password as string,
    database: scratchDb,
  });
  await scratch.connect();
  return scratch;
};

beforeEach(async () => {
  const wb = await workerDb();
  scratchDb = `${wb.databaseName}_data_change`;
  await wb.admin.query(`drop database if exists ${scratchDb} with (force)`);
  // Explicit UTF8, the same as the test template. A bare `create database`
  // inherits the cluster's encoding, which on a Windows install is WIN1252,
  // and a migration carrying any character WIN1252 cannot represent then
  // fails here and nowhere else. CI's Postgres initialises as UTF8, so the
  // difference shows up only on a developer's machine, where it reads as a
  // bug in whatever migration happens to be newest.
  await wb.admin.query(
    `create database ${scratchDb} ` +
      `encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`,
  );
  client = await connectScratch();
});

afterEach(async () => {
  await client.end();
  const wb = await workerDb();
  await wb.admin.query(`drop database if exists ${scratchDb} with (force)`);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/** Two rows at a time, flagging them, returning the batch's own cursor and
 * count. Shared by `countingScript` and the deliberately-flaky variant
 * below, so both run the exact same batch logic. */
async function runCountingBatch(
  tx: DataChangeClient,
  cursor: string | null,
): Promise<DataChangeBatchResult> {
  const { rows } = await tx.query<{ id: number }>(
    `update _counting_fixture
        set flagged = true
      where flagged = false
        and id in (
          select id from _counting_fixture
           where flagged = false
             and ($1::int is null or id > $1::int)
           order by id
           limit 2
        )
      returning id`,
    [cursor],
  );
  const lastId =
    rows.length > 0 ? String(Math.max(...rows.map((row) => row.id))) : cursor;
  return {
    done: rows.length < 2,
    cursor: lastId ?? undefined,
    rowsChanged: rows.length,
  };
}

/** A script over a tiny table of its own, batching two rows at a time,
 * counting how many times `runBatch` is actually called so a test can
 * prove resumption picks up mid-script rather than restarting. */
function countingScript(calls: { n: number }): DataChangeScript {
  return {
    name: "0001_counting",
    summary: "Sets flagged = true on every row of _counting_fixture.",
    expects: [
      { table: "_counting_fixture", column: "id", dataType: "integer" },
      { table: "_counting_fixture", column: "flagged", dataType: "boolean" },
    ],
    async runBatch(tx, cursor) {
      calls.n += 1;
      return runCountingBatch(tx, cursor);
    },
  };
}

describe("runDataChanges", () => {
  it("batches through every row and records the ledger as complete", async () => {
    await client.query(
      "create table _counting_fixture (id int primary key, flagged boolean not null default false)",
    );
    await client.query(
      "insert into _counting_fixture (id) select generate_series(1, 5)",
    );

    const calls = { n: 0 };
    const outcomes = await runDataChanges(client, {
      scripts: [countingScript(calls)],
    });

    expect(outcomes).toEqual([
      { name: "0001_counting", batches: 3, rowsChanged: 5 },
    ]);
    expect(calls.n).toBe(3); // 2 + 2 + 1

    const flagged = await client.query(
      "select count(*)::int as n from _counting_fixture where flagged",
    );
    expect(flagged.rows[0]?.n).toBe(5);

    const ledger = await client.query(
      "select completed_at, batches, rows_changed from _data_changes where name = '0001_counting'",
    );
    expect(ledger.rows[0]?.completed_at).not.toBeNull();
    expect(ledger.rows[0]?.batches).toBe(3);
    expect(Number(ledger.rows[0]?.rows_changed)).toBe(5);
  });

  it("is idempotent: a completed script runs no batches on a second call", async () => {
    await client.query(
      "create table _counting_fixture (id int primary key, flagged boolean not null default false)",
    );
    await client.query("insert into _counting_fixture (id) values (1)");

    const first = { n: 0 };
    await runDataChanges(client, { scripts: [countingScript(first)] });
    expect(first.n).toBe(1);

    const second = { n: 0 };
    const outcomes = await runDataChanges(client, {
      scripts: [countingScript(second)],
    });
    expect(outcomes).toEqual([]);
    expect(second.n).toBe(0);
  });

  it("resumes from the last committed cursor rather than restarting", async () => {
    await client.query(
      "create table _counting_fixture (id int primary key, flagged boolean not null default false)",
    );
    await client.query(
      "insert into _counting_fixture (id) select generate_series(1, 4)",
    );

    // A script whose second batch always throws, simulating a crash after
    // the first batch already committed.
    let attempt = 0;
    const flaky: DataChangeScript = {
      name: "0001_counting",
      summary: "Sets flagged = true on every row of _counting_fixture.",
      expects: [
        { table: "_counting_fixture", column: "id", dataType: "integer" },
        { table: "_counting_fixture", column: "flagged", dataType: "boolean" },
      ],
      async runBatch(tx, cursor) {
        attempt += 1;
        if (attempt === 2) {
          throw new Error("simulated crash");
        }
        return runCountingBatch(tx, cursor);
      },
    };

    await expect(
      runDataChanges(client, { scripts: [flaky] }),
    ).rejects.toBeInstanceOf(DataChangeError);

    const afterCrash = await client.query(
      "select count(*)::int as n from _counting_fixture where flagged",
    );
    expect(afterCrash.rows[0]?.n).toBe(2); // only the first batch landed

    // A fresh run resumes: it must not re-run the first batch's rows, and
    // must finish the remaining two.
    const resumed = { n: 0 };
    const outcomes = await runDataChanges(client, {
      scripts: [countingScript(resumed)],
    });
    expect(outcomes[0]?.rowsChanged).toBe(2); // only the remaining rows
    // Two calls, not the three a from-scratch run needs (2 + 2 + 0): the
    // first finds exactly the two remaining rows and cannot yet tell that
    // is all of them (its own `done` only turns true on a batch smaller
    // than the limit), so a second, empty batch is what actually confirms
    // completion. Resuming still skips the batch a from-scratch run would
    // have spent on the two rows this test's own crash already committed.
    expect(resumed.n).toBe(2);

    const afterResume = await client.query(
      "select count(*)::int as n from _counting_fixture where flagged",
    );
    expect(afterResume.rows[0]?.n).toBe(4);
  });

  it("refuses a script whose expected column no longer exists", async () => {
    const script: DataChangeScript = {
      name: "0001_stale",
      summary: "Expects a column that was never created.",
      expects: [
        {
          table: "_counting_fixture",
          column: "does_not_exist",
          dataType: "text",
        },
      ],
      async runBatch() {
        return { done: true, rowsChanged: 0 };
      },
    };
    await client.query("create table _counting_fixture (id int primary key)");

    await expect(runDataChanges(client, { scripts: [script] })).rejects.toThrow(
      /does_not_exist/,
    );
  });

  it("refuses a script whose expected column changed type", async () => {
    const script: DataChangeScript = {
      name: "0001_retyped",
      summary: "Expects an integer id, finds text.",
      expects: [
        { table: "_counting_fixture", column: "id", dataType: "integer" },
      ],
      async runBatch() {
        return { done: true, rowsChanged: 0 };
      },
    };
    await client.query("create table _counting_fixture (id text primary key)");

    await expect(runDataChanges(client, { scripts: [script] })).rejects.toThrow(
      /expects _counting_fixture\.id to be integer/,
    );
  });

  it("refuses two scripts with the same name", async () => {
    const a = countingScript({ n: 0 });
    const b = countingScript({ n: 0 });
    await expect(
      runDataChanges(client, { scripts: [a, b] }),
    ).rejects.toBeInstanceOf(DataChangeError);
  });
});

describe("the sample script: backfilling member timezone", () => {
  it("sets a member's timezone from their workspace's, only where it was null", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });

    // Both tables' own id columns are deliberately without a database
    // default (§3: "application-generated... a row arriving without an id
    // is a bug, not something to paper over"), so a raw insert has to
    // supply one itself the way the application layer always does.
    const workspace = await client.query<{ id: string }>(
      `insert into workspaces (id, name, slug, settings)
       values (gen_random_uuid(), 'Acme', 'acme', '{"timezone": "Asia/Kuala_Lumpur"}'::jsonb)
       returning id`,
    );
    const workspaceId = workspace.rows[0]?.id;

    await client.query(
      `insert into workspace_members (id, workspace_id, name, kind, status, timezone)
       values (gen_random_uuid(), $1, 'No Timezone', 'human', 'active', null),
              (gen_random_uuid(), $1, 'Has Timezone', 'human', 'active', 'UTC')`,
      [workspaceId],
    );

    const outcomes = await runDataChanges(client, {
      scripts: [backfillMemberTimezone],
    });
    expect(outcomes[0]?.rowsChanged).toBe(1);

    const members = await client.query<{ name: string; timezone: string }>(
      "select name, timezone from workspace_members order by name",
    );
    expect(members.rows).toEqual([
      { name: "Has Timezone", timezone: "UTC" },
      { name: "No Timezone", timezone: "Asia/Kuala_Lumpur" },
    ]);
  });
});

describe("0006: seeding the Champion into workspaces that predate it", () => {
  it("creates the agent, its member and a view binding on every existing space", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });

    const workspace = await client.query<{ id: string }>(
      `insert into workspaces (id, name, slug, settings)
       values (gen_random_uuid(), 'Old', 'old', '{}'::jsonb)
       returning id`,
    );
    const workspaceId = workspace.rows[0]?.id as string;

    const space = await client.query<{ id: string }>(
      `insert into spaces (id, workspace_id, name)
       values (gen_random_uuid(), $1, 'Product') returning id`,
      [workspaceId],
    );
    const spaceId = space.rows[0]?.id as string;
    await client.query(
      `insert into access_contexts (id, workspace_id, resource_type, resource_id)
       values (gen_random_uuid(), $1, 'space', $2)`,
      [workspaceId, spaceId],
    );

    const first = await runDataChanges(client, {
      scripts: [seedChampionAgent],
    });
    expect(first[0]?.rowsChanged).toBe(1);

    const agent = await client.query<{
      kind: string;
      schedule: string;
      autonomy: string;
      member_kind: string;
    }>(
      `select a.kind, a.schedule, a.autonomy, m.kind as member_kind
         from agents a join workspace_members m on m.id = a.member_id
        where a.workspace_id = $1`,
      [workspaceId],
    );
    expect(agent.rows).toEqual([
      {
        kind: "champion",
        schedule: "hourly",
        autonomy: "propose",
        member_kind: "agent",
      },
    ]);

    // Bound to the space, and to nothing else. The workspace context is the
    // one grant a rhythm agent must never hold.
    const bindings = await client.query<{
      resource_type: string;
      level: number;
    }>(
      `select c.resource_type, b.level
         from agents a
         join access_groups g on g.member_id = a.member_id and g.kind = 'member'
         join access_bindings b on b.group_id = g.id
         join access_contexts c on c.id = b.context_id
        where a.workspace_id = $1`,
      [workspaceId],
    );
    expect(bindings.rows).toEqual([{ resource_type: "space", level: 10 }]);
  });

  it("leaves a workspace that already has a Champion alone", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });

    const workspace = await client.query<{ id: string }>(
      `insert into workspaces (id, name, slug, settings)
       values (gen_random_uuid(), 'New', 'new', '{}'::jsonb)
       returning id`,
    );
    const workspaceId = workspace.rows[0]?.id as string;

    await runDataChanges(client, { scripts: [seedChampionAgent] });
    // A second run over the same rows: the ledger would skip a finished
    // script, so the script is called directly to prove the predicate itself
    // is what makes it safe.
    const again = await seedChampionAgent.runBatch(client, null);
    expect(again.rowsChanged).toBe(0);

    const count = await client.query<{ n: string }>(
      "select count(*)::text as n from agents where workspace_id = $1",
      [workspaceId],
    );
    expect(count.rows[0]?.n).toBe("1");
  });
});

describe("0008: recording the goal on blockers that have none", () => {
  it("takes each blocker's goal from its key result, and leaves one with no key result alone", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });

    // The shape `sessions.createBlocker` left behind before completeness
    // review H-10: a key result, and no goal. Raw inserts, because this is a
    // repair of rows the application wrote wrongly, and the application no
    // longer writes them that way.
    const { rows } = await client.query<{
      workspace_id: string;
      goal_id: string;
      key_result_id: string;
      member_id: string;
    }>(
      `with w as (
         insert into workspaces (id, name, slug)
         values (gen_random_uuid(), 'Acme', 'acme') returning id
       ), m as (
         insert into workspace_members (id, workspace_id, name, kind, status)
         select gen_random_uuid(), w.id, 'Owner', 'human', 'active' from w
         returning id, workspace_id
       ), g as (
         insert into goals (id, workspace_id, title, level, owner_kind,
                            champion_id, reviewer_id, timeframe)
         select gen_random_uuid(), m.workspace_id, 'Keep customers', 'company',
                'workspace', m.id, m.id,
                '{"start": "2026-07-01", "end": "2026-09-30"}'::jsonb
           from m
         returning id, workspace_id
       ), k as (
         insert into key_results (id, workspace_id, goal_id, title, direction,
                                  indicator_type, baseline_value,
                                  target_value, current_value)
         select gen_random_uuid(), g.workspace_id, g.id, 'Retention',
                'increase', 'lagging', 0, 10, 0
           from g
         returning id, goal_id, workspace_id
       )
       select k.workspace_id, k.goal_id, k.id as key_result_id, m.id as member_id
         from k, m`,
    );
    const seeded = rows[0];
    if (!seeded) {
      throw new Error("seeding failed");
    }

    await client.query(
      `insert into blockers (id, workspace_id, key_result_id, type, owner_id,
                             next_action, opened_at, due_at, source)
       values (gen_random_uuid(), $1, $2, 'resource', $3, 'Ask', now(), now(), 'session'),
              (gen_random_uuid(), $1, null, 'resource', $3, 'Ask', now(), now(), 'manual')`,
      [seeded.workspace_id, seeded.key_result_id, seeded.member_id],
    );

    const outcomes = await runDataChanges(client, {
      scripts: [backfillBlockerGoal],
    });
    expect(outcomes[0]?.rowsChanged).toBe(1);

    const after = await client.query<{ goal_id: string | null }>(
      "select goal_id from blockers order by key_result_id nulls last",
    );
    expect(after.rows.map((row) => row.goal_id)).toEqual([
      seeded.goal_id,
      null,
    ]);
  });
});

describe("0009: binding the built-in agents to what belongs to no space", () => {
  it("binds both agents to a company goal and a workspace KPI, gives the KPI a context, and leaves space items alone", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });

    // A workspace as it stood before completeness review H-04: two agents
    // bound to their space, a company goal with its own context and no agent
    // binding, a workspace KPI with no context at all, and a space KPI.
    const { rows } = await client.query<{
      workspace_id: string;
      goal_context: string;
      kpi_id: string;
      space_kpi_id: string;
    }>(
      `with w as (
         insert into workspaces (id, name, slug)
         values (gen_random_uuid(), 'Acme', 'acme') returning id
       ), s as (
         insert into spaces (id, workspace_id, name)
         select gen_random_uuid(), w.id, 'Product' from w returning id, workspace_id
       ), owner as (
         insert into workspace_members (id, workspace_id, name, kind, status)
         select gen_random_uuid(), w.id, 'Owner', 'human', 'active' from w
         returning id, workspace_id
       ), champion as (
         insert into workspace_members (id, workspace_id, name, kind, status)
         select gen_random_uuid(), w.id, 'OKR Champion', 'agent', 'active' from w
         returning id, workspace_id
       ), coach as (
         insert into workspace_members (id, workspace_id, name, kind, status)
         select gen_random_uuid(), w.id, 'OKR Coach', 'agent', 'active' from w
         returning id, workspace_id
       ), agents_in as (
         insert into agents (id, workspace_id, member_id, name, kind)
         select gen_random_uuid(), champion.workspace_id, champion.id, 'OKR Champion', 'champion' from champion
         union all
         select gen_random_uuid(), coach.workspace_id, coach.id, 'OKR Coach', 'coach' from coach
         returning id
       ), groups_in as (
         insert into access_groups (id, workspace_id, kind, member_id)
         select gen_random_uuid(), champion.workspace_id, 'member', champion.id from champion
         union all
         select gen_random_uuid(), coach.workspace_id, 'member', coach.id from coach
         returning id
       ), g as (
         insert into goals (id, workspace_id, title, level, owner_kind,
                            champion_id, reviewer_id, timeframe)
         select gen_random_uuid(), owner.workspace_id, 'Keep customers',
                'company', 'workspace', owner.id, owner.id,
                '{"start": "2026-07-01", "end": "2026-09-30"}'::jsonb
           from owner
         returning id, workspace_id
       ), gc as (
         insert into access_contexts (id, workspace_id, resource_type, resource_id)
         select gen_random_uuid(), g.workspace_id, 'goal', g.id from g
         returning id
       ), k as (
         insert into kpis (id, workspace_id, short_id, title, frequency)
         select gen_random_uuid(), w.id, 'K-1', 'Net revenue retention', 'monthly' from w
         returning id
       ), sk as (
         insert into kpis (id, workspace_id, short_id, title, frequency, owner_kind, space_id)
         select gen_random_uuid(), s.workspace_id, 'K-2', 'Activation', 'weekly', 'space', s.id from s
         returning id
       )
       select w.id as workspace_id, gc.id as goal_context,
              k.id as kpi_id, sk.id as space_kpi_id
         from w, gc, k, sk, (select count(*) from agents_in) a, (select count(*) from groups_in) gr`,
    );
    const seeded = rows[0];
    if (!seeded) {
      throw new Error("seeding failed");
    }

    const outcomes = await runDataChanges(client, {
      scripts: [bindAgentsToSpacelessItems],
    });
    // Two agents times a goal and a KPI.
    expect(outcomes[0]?.rowsChanged).toBe(4);

    const contexts = await client.query<{ resource_id: string }>(
      "select resource_id from access_contexts where resource_type = 'kpi'",
    );
    expect(contexts.rows.map((row) => row.resource_id)).toEqual([
      seeded.kpi_id,
    ]);

    const bindings = await client.query<{
      member_name: string;
      resource_type: string;
    }>(
      `select m.name as member_name, c.resource_type
         from access_bindings b
         join access_groups g on g.id = b.group_id
         join workspace_members m on m.id = g.member_id
         join access_contexts c on c.id = b.context_id
        order by m.name, c.resource_type`,
    );
    expect(bindings.rows).toEqual([
      { member_name: "OKR Champion", resource_type: "goal" },
      { member_name: "OKR Champion", resource_type: "kpi" },
      { member_name: "OKR Coach", resource_type: "goal" },
      { member_name: "OKR Coach", resource_type: "kpi" },
    ]);

    // A second run of the ledger does nothing; a fresh run of the script,
    // as after a restore, binds nothing new either.
    await client.query("delete from _data_changes");
    const again = await runDataChanges(client, {
      scripts: [bindAgentsToSpacelessItems],
    });
    expect(again[0]?.rowsChanged).toBe(0);
  });
});
