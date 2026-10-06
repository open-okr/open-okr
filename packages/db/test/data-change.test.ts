import { randomBytes } from "node:crypto";
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
import { scrubErasedMemberNames } from "../src/data-changes/0010_scrub_erased_member_names.ts";
import { sealAccountTokens } from "../src/data-changes/0011_seal_account_tokens.ts";
import { carryStrategicIssueMinimum } from "../src/data-changes/0014_carry_strategic_issue_minimum.ts";
import { carryObjectiveLengthLimit } from "../src/data-changes/0015_carry_objective_length_limit.ts";
import { carryCoachStrictness } from "../src/data-changes/0016_carry_coach_strictness.ts";
import { keyResultKindFromDirection } from "../src/data-changes/0017_key_result_kind_from_direction.ts";
import { keyResultScoreComputed } from "../src/data-changes/0018_key_result_score_computed.ts";
import { dropAlignmentPenalties } from "../src/data-changes/0019_drop_alignment_penalties.ts";
import { kpiTargetTypeFromDirection } from "../src/data-changes/0020_kpi_target_type_from_direction.ts";
import { kpiRecoveringToBand } from "../src/data-changes/0021_kpi_recovering_to_band.ts";
import { kpiNamedOwner } from "../src/data-changes/0022_kpi_named_owner.ts";
import { blockerClockToCheckIn } from "../src/data-changes/0023_blocker_clock_to_check_in.ts";
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

describe("0010: taking erased members' names out of the feed", () => {
  it("strips the name from member.erased, replaces it on entries about the erased member, and leaves everyone else's", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
    const { rows } = await client.query<{
      erased_id: string;
      kept_id: string;
      workspace_id: string;
    }>(
      `with w as (
         insert into workspaces (id, name, slug)
         values (gen_random_uuid(), 'Acme', 'acme') returning id
       ), erased as (
         insert into workspace_members (id, workspace_id, name, kind, status)
         select gen_random_uuid(), w.id, 'Erased member', 'human', 'suspended' from w
         returning id, workspace_id
       ), kept as (
         insert into workspace_members (id, workspace_id, name, kind, status)
         select gen_random_uuid(), w.id, 'Still Here', 'human', 'active' from w
         returning id
       )
       select erased.id as erased_id, kept.id as kept_id,
              erased.workspace_id
         from erased, kept`,
    );
    const seeded = rows[0] as {
      erased_id: string;
      kept_id: string;
      workspace_id: string;
    };
    const insert = (kind: string, subject: string, name: string) =>
      client.query(
        `insert into activities (id, workspace_id, kind, payload, actor_kind, subject_type, subject_id)
         values (gen_random_uuid(), $1, $2, jsonb_build_object('name', $3::text), 'human', 'workspace_member', $4)`,
        [seeded.workspace_id, kind, name, subject],
      );
    await insert("member.erased", seeded.erased_id, "Real Name");
    await insert("member.updated", seeded.erased_id, "Real Name");
    await insert("member.updated", seeded.kept_id, "Still Here");

    const [result] = await runDataChanges(client, {
      scripts: [scrubErasedMemberNames],
    });
    expect(result?.rowsChanged).toBe(2);

    const after = await client.query<{ kind: string; payload: object }>(
      "select kind, payload from activities order by kind, payload::text",
    );
    expect(after.rows).toEqual([
      { kind: "member.erased", payload: {} },
      { kind: "member.updated", payload: { name: "Erased member" } },
      { kind: "member.updated", payload: { name: "Still Here" } },
    ]);

    await client.query("delete from _data_changes");
    const [again] = await runDataChanges(client, {
      scripts: [scrubErasedMemberNames],
    });
    expect(again?.rowsChanged).toBe(0);
  });
});

describe("0011: sealing the identity-provider tokens stored in plain text", () => {
  const ROOT = randomBytes(32).toString("base64");
  const SEALED =
    /^openokr-sealed:v1:[0-9a-f]{16}:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

  const seedAccount = async (
    id: string,
    tokens: [string | null, string | null, string | null],
  ) => {
    await client.query(
      "insert into users (id, name, email) values ($1, $1, $2)",
      [id, `${id}@example.com`],
    );
    await client.query(
      `insert into accounts (id, user_id, account_id, provider_id,
                             access_token, refresh_token, id_token)
       values ($1, $1, $1, 'sso-okta', $2, $3, $4)`,
      [id, ...tokens],
    );
  };

  const tokensOf = async (id: string) =>
    (
      await client.query<{
        access_token: string | null;
        refresh_token: string | null;
        id_token: string | null;
      }>(
        "select access_token, refresh_token, id_token from accounts where id = $1",
        [id],
      )
    ).rows[0];

  beforeEach(async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
  });

  it("seals a plain token and leaves sealed, empty and missing ones alone", async () => {
    const already = `openokr-sealed:v1:${"a".repeat(16)}:AAAA:BBBB`;
    await seedAccount("plain", ["access-1", "refresh-1", "eyJ.id.token"]);
    await seedAccount("mixed", [already, "", null]);
    await seedAccount("password", [null, null, null]);

    const [result] = await runDataChanges(client, {
      scripts: [sealAccountTokens(ROOT)],
    });
    expect(result?.rowsChanged).toBe(1);

    const plain = await tokensOf("plain");
    for (const value of Object.values(plain ?? {})) {
      expect(value).toMatch(SEALED);
    }
    // The plain tokens in full, not a fragment of one: base64 ciphertext
    // spells "eyJ" by chance about once in a few hundred runs, which is how
    // this assertion failed on 6 October 2026 with every token sealed.
    expect(JSON.stringify(plain)).not.toMatch(
      /access-1|refresh-1|eyJ\.id\.token/,
    );
    // A fresh data key per token, so equal tokens never look equal at rest.
    expect(new Set(Object.values(plain ?? {})).size).toBe(3);

    expect(await tokensOf("mixed")).toEqual({
      access_token: already,
      refresh_token: "",
      id_token: null,
    });
    expect(await tokensOf("password")).toEqual({
      access_token: null,
      refresh_token: null,
      id_token: null,
    });
  });

  it("changes nothing on a second run, as after a restore", async () => {
    await seedAccount("twice", ["access-2", null, null]);
    await runDataChanges(client, { scripts: [sealAccountTokens(ROOT)] });
    const first = await tokensOf("twice");

    await client.query("delete from _data_changes");
    const [again] = await runDataChanges(client, {
      scripts: [sealAccountTokens(ROOT)],
    });
    expect(again?.rowsChanged).toBe(0);
    expect(await tokensOf("twice")).toEqual(first);
  });

  it("works through more rows than one batch holds", async () => {
    await client.query(
      `insert into users (id, name, email)
       select 'u' || n, 'u' || n, 'u' || n || '@example.com'
         from generate_series(1, 450) n`,
    );
    await client.query(
      `insert into accounts (id, user_id, account_id, provider_id, access_token)
       select 'u' || n, 'u' || n, 'u' || n, 'sso-okta', 'token-' || n
         from generate_series(1, 450) n`,
    );

    const [result] = await runDataChanges(client, {
      scripts: [sealAccountTokens(ROOT)],
    });
    expect(result?.rowsChanged).toBe(450);
    expect(result?.batches).toBeGreaterThan(1);

    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from accounts
        where access_token not like 'openokr-sealed:v1:%'`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("needs no key on an instance with nothing to seal", async () => {
    await seedAccount("nothing", [null, null, null]);
    const [result] = await runDataChanges(client, {
      scripts: [sealAccountTokens(undefined)],
    });
    expect(result?.rowsChanged).toBe(0);
  });

  it("refuses to finish without a key when a token is in plain text", async () => {
    // A completed ledger row would claim the tokens are sealed when they are
    // not, so this fails loudly and leaves the script to run again.
    await seedAccount("stranded", ["access-3", null, null]);
    const error = await runDataChanges(client, {
      scripts: [sealAccountTokens(undefined)],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DataChangeError);
    // The runner names the batch; the script's own reason is the cause.
    expect(String((error as Error).cause)).toContain("OPENOKR_ENCRYPTION_KEY");

    expect((await tokensOf("stranded"))?.access_token).toBe("access-3");
    const { rows } = await client.query<{ completed_at: string | null }>(
      "select completed_at from _data_changes where name = '0011_seal_account_tokens'",
    );
    expect(rows[0]?.completed_at).toBeNull();
  });

  it("refuses a key that is not 32 bytes of base64, without repeating it", async () => {
    await seedAccount("bad-key", ["access-4", null, null]);
    const error = await runDataChanges(client, {
      scripts: [sealAccountTokens("not-a-key")],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DataChangeError);
    const cause = (error as Error).cause as Error;
    expect(cause.message).toContain("32-byte key");
    expect(`${(error as Error).message} ${cause.message}`).not.toContain(
      "not-a-key",
    );
  });
});

describe("0013: carrying the strategic issue floor onto its new threshold", () => {
  it("moves a raised floor, drops the canon one and anything unreadable, and keeps a value already set", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
    const seed = async (slug: string, overrides: object) => {
      const { rows } = await client.query<{ id: string }>(
        `with w as (
           insert into workspaces (id, name, slug)
           values (gen_random_uuid(), $1, $1) returning id
         )
         insert into rhythm_settings (workspace_id, overrides)
         select w.id, $2::jsonb from w
         returning workspace_id as id`,
        [slug, JSON.stringify(overrides)],
      );
      return rows[0]?.id as string;
    };
    const raised = await seed("raised", {
      "quality.strategicIssueBounds": { low: 5, high: 10 },
      "cadence.graceDays": 4,
    });
    const canon = await seed("canon", {
      "quality.strategicIssueBounds": { low: 3, high: 8 },
    });
    const garbled = await seed("garbled", {
      "quality.strategicIssueBounds": { low: "five" },
    });
    const both = await seed("both", {
      "quality.strategicIssueBounds": { low: 6, high: 10 },
      "quality.strategicIssueMinimum": 4,
    });
    const untouched = await seed("untouched", { "cadence.graceDays": 2 });

    const [result] = await runDataChanges(client, {
      scripts: [carryStrategicIssueMinimum],
    });
    expect(result?.rowsChanged).toBe(4);

    const overridesOf = async (id: string) =>
      (
        await client.query<{ overrides: object }>(
          "select overrides from rhythm_settings where workspace_id = $1",
          [id],
        )
      ).rows[0]?.overrides;
    expect(await overridesOf(raised)).toEqual({
      "quality.strategicIssueMinimum": 5,
      "cadence.graceDays": 4,
    });
    expect(await overridesOf(canon)).toEqual({});
    expect(await overridesOf(garbled)).toEqual({});
    expect(await overridesOf(both)).toEqual({
      "quality.strategicIssueMinimum": 4,
    });
    expect(await overridesOf(untouched)).toEqual({ "cadence.graceDays": 2 });

    await client.query("delete from _data_changes");
    const [again] = await runDataChanges(client, {
      scripts: [carryStrategicIssueMinimum],
    });
    expect(again?.rowsChanged).toBe(0);
  });
});

describe("0014: carrying the objective length limit onto its new threshold", () => {
  it("moves a changed upper bound, drops the canon one, and keeps a value already set", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
    const seed = async (slug: string, overrides: object) => {
      const { rows } = await client.query<{ id: string }>(
        `with w as (
           insert into workspaces (id, name, slug)
           values (gen_random_uuid(), $1, $1) returning id
         )
         insert into rhythm_settings (workspace_id, overrides)
         select w.id, $2::jsonb from w
         returning workspace_id as id`,
        [slug, JSON.stringify(overrides)],
      );
      return rows[0]?.id as string;
    };
    const longer = await seed("longer", {
      "quality.objectiveLengthWords": { low: 3, high: 24 },
    });
    const canon = await seed("canon", {
      "quality.objectiveLengthWords": { low: 2, high: 18 },
    });
    const both = await seed("both", {
      "quality.objectiveLengthWords": { low: 4, high: 30 },
      "quality.objectiveLengthLimit": 20,
    });

    const [result] = await runDataChanges(client, {
      scripts: [carryObjectiveLengthLimit],
    });
    expect(result?.rowsChanged).toBe(3);

    const overridesOf = async (id: string) =>
      (
        await client.query<{ overrides: object }>(
          "select overrides from rhythm_settings where workspace_id = $1",
          [id],
        )
      ).rows[0]?.overrides;
    expect(await overridesOf(longer)).toEqual({
      "quality.objectiveLengthLimit": 24,
    });
    expect(await overridesOf(canon)).toEqual({});
    expect(await overridesOf(both)).toEqual({
      "quality.objectiveLengthLimit": 20,
    });

    await client.query("delete from _data_changes");
    const [again] = await runDataChanges(client, {
      scripts: [carryObjectiveLengthLimit],
    });
    expect(again?.rowsChanged).toBe(0);
  });
});

describe("0015: carrying a strict Coach onto strict mode", () => {
  it("turns strict mode on where the Coach was strict, clears the column, and leaves the rest", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
    const seed = async (slug: string, strictness: string, practice: object) => {
      const { rows } = await client.query<{ id: string }>(
        `with w as (
           insert into workspaces (id, name, slug)
           values (gen_random_uuid(), $1, $1) returning id
         )
         insert into rhythm_settings (workspace_id, coach_strictness, practice)
         select w.id, $2, $3::jsonb from w
         returning workspace_id as id`,
        [slug, strictness, JSON.stringify(practice)],
      );
      return rows[0]?.id as string;
    };
    const strict = await seed("strict", "strict", { reviewer: "required" });
    const advisory = await seed("advisory", "advisory", {});
    const warn = await seed("warn", "warn", {});

    const [result] = await runDataChanges(client, {
      scripts: [carryCoachStrictness],
    });
    expect(result?.rowsChanged).toBe(1);

    const rowOf = async (id: string) =>
      (
        await client.query<{ coach_strictness: string; practice: object }>(
          "select coach_strictness, practice from rhythm_settings where workspace_id = $1",
          [id],
        )
      ).rows[0];
    expect(await rowOf(strict)).toEqual({
      coach_strictness: "warn",
      practice: { reviewer: "required", strictMode: "on" },
    });
    expect(await rowOf(advisory)).toEqual({
      coach_strictness: "advisory",
      practice: {},
    });
    expect(await rowOf(warn)).toEqual({
      coach_strictness: "warn",
      practice: {},
    });

    await client.query("delete from _data_changes");
    const [again] = await runDataChanges(client, {
      scripts: [carryCoachStrictness],
    });
    expect(again?.rowsChanged).toBe(0);
  });
});

describe("0017: maintain key results from their direction", () => {
  it("makes a key result written with a maintain direction a maintain key result, and leaves the rest", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
    const { rows } = await client.query<{ direction: string; id: string }>(
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
         select gen_random_uuid(), m.workspace_id, 'Keep the service up',
                'company', 'workspace', m.id, m.id,
                '{"start": "2026-07-01", "end": "2026-09-30"}'::jsonb
           from m
         returning id, workspace_id
       )
       insert into key_results (id, workspace_id, goal_id, title, direction,
                                indicator_type, baseline_value, target_value,
                                current_value)
       select gen_random_uuid(), g.workspace_id, g.id, d.title, d.direction,
              'lagging', 0, 10, 0
         from g,
              (values ('Uptime', 'maintain'), ('Activation', 'increase'))
                as d(title, direction)
       returning direction, id`,
    );
    // Both arrive as metric, the column's default, before the script runs.
    const kinds = async () =>
      Object.fromEntries(
        (
          await client.query<{ direction: string; kind: string }>(
            "select direction, kind from key_results",
          )
        ).rows.map((row) => [row.direction, row.kind]),
      );
    expect(rows).toHaveLength(2);
    expect(await kinds()).toEqual({ maintain: "metric", increase: "metric" });

    const [result] = await runDataChanges(client, {
      scripts: [keyResultKindFromDirection],
    });
    expect(result?.rowsChanged).toBe(1);
    expect(await kinds()).toEqual({
      maintain: "maintain",
      increase: "metric",
    });

    await client.query("delete from _data_changes");
    const [again] = await runDataChanges(client, {
      scripts: [keyResultKindFromDirection],
    });
    expect(again?.rowsChanged).toBe(0);
  });
});

describe("0018: the computed score of key results scored before adjusting existed", () => {
  it("copies a scored key result's score into its computed score, and leaves the unscored", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
    await client.query(
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
         select gen_random_uuid(), m.workspace_id, 'Win mid-market',
                'company', 'workspace', m.id, m.id,
                '{"start": "2026-01-01", "end": "2026-03-31"}'::jsonb
           from m
         returning id, workspace_id
       )
       insert into key_results (id, workspace_id, goal_id, title, direction,
                                indicator_type, baseline_value, target_value,
                                current_value, score)
       select gen_random_uuid(), g.workspace_id, g.id, d.title, 'increase',
              'lagging', 0, 10, 0, d.score
         from g,
              (values ('Scored', 0.7::numeric), ('Unscored', null::numeric))
                as d(title, score)`,
    );
    const computed = async () =>
      Object.fromEntries(
        (
          await client.query<{ title: string; score_computed: string | null }>(
            "select title, score_computed from key_results",
          )
        ).rows.map((row) => [row.title, row.score_computed]),
      );
    expect(await computed()).toEqual({ Scored: null, Unscored: null });

    const [result] = await runDataChanges(client, {
      scripts: [keyResultScoreComputed],
    });
    expect(result?.rowsChanged).toBe(1);
    expect(await computed()).toEqual({ Scored: "0.70", Unscored: null });

    await client.query("delete from _data_changes");
    const [again] = await runDataChanges(client, {
      scripts: [keyResultScoreComputed],
    });
    expect(again?.rowsChanged).toBe(0);
  });
});

describe("0019: the retired alignment penalties", () => {
  it("removes the penalties and keeps every other override, the healthy threshold included", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
    const seed = async (slug: string, overrides: object) => {
      const { rows } = await client.query<{ id: string }>(
        `with w as (
           insert into workspaces (id, name, slug)
           values (gen_random_uuid(), $1, $1) returning id
         )
         insert into rhythm_settings (workspace_id, overrides)
         select w.id, $2::jsonb from w
         returning workspace_id as id`,
        [slug, JSON.stringify(overrides)],
      );
      return rows[0]?.id as string;
    };
    const tuned = await seed("tuned", {
      "alignment.penalties": { noAnchor: 20, orphan: 5 },
      "alignment.healthyThreshold": 70,
      "cadence.graceDays": 2,
    });
    const untouched = await seed("untouched", { "cadence.graceDays": 3 });

    const [result] = await runDataChanges(client, {
      scripts: [dropAlignmentPenalties],
    });
    expect(result?.rowsChanged).toBe(1);

    const overridesOf = async (id: string) =>
      (
        await client.query<{ overrides: object }>(
          "select overrides from rhythm_settings where workspace_id = $1",
          [id],
        )
      ).rows[0]?.overrides;
    expect(await overridesOf(tuned)).toEqual({
      "alignment.healthyThreshold": 70,
      "cadence.graceDays": 2,
    });
    expect(await overridesOf(untouched)).toEqual({ "cadence.graceDays": 3 });

    await client.query("delete from _data_changes");
    const [again] = await runDataChanges(client, {
      scripts: [dropAlignmentPenalties],
    });
    expect(again?.rowsChanged).toBe(0);
  });
});

describe("0020: the target type each KPI's direction implies", () => {
  it("writes at least or at most, and leaves a type already set", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
    await client.query(
      `with w as (
         insert into workspaces (id, name, slug)
         values (gen_random_uuid(), 'Acme', 'acme') returning id
       )
       insert into kpis (id, workspace_id, short_id, title, frequency,
                         direction, target_type)
       select gen_random_uuid(), w.id, d.short_id, d.title, 'monthly',
              d.direction, d.target_type
         from w,
              (values ('K-1', 'Revenue', 'higher_better', null),
                      ('K-2', 'Churn', 'lower_better', null),
                      ('K-3', 'Uptime', 'higher_better', 'range'))
                as d(short_id, title, direction, target_type)`,
    );
    const types = async () =>
      Object.fromEntries(
        (
          await client.query<{ title: string; target_type: string | null }>(
            "select title, target_type from kpis",
          )
        ).rows.map((row) => [row.title, row.target_type]),
      );

    const [result] = await runDataChanges(client, {
      scripts: [kpiTargetTypeFromDirection],
    });
    expect(result?.rowsChanged).toBe(2);
    expect(await types()).toEqual({
      Revenue: "at_least",
      Churn: "at_most",
      Uptime: "range",
    });

    await client.query("delete from _data_changes");
    const [again] = await runDataChanges(client, {
      scripts: [kpiTargetTypeFromDirection],
    });
    expect(again?.rowsChanged).toBe(0);
  });
});

describe("0021: a recovering KPI reads its real band", () => {
  it("rewrites recovering to the corridor band, and leaves the rest", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
    await client.query(
      `with w as (
         insert into workspaces (id, name, slug)
         values (gen_random_uuid(), 'Acme', 'acme') returning id
       )
       insert into kpis (id, workspace_id, short_id, title, frequency, state,
                         achievement_pct, green_low, red_low)
       select gen_random_uuid(), w.id, d.short_id, d.title, 'monthly',
              d.state, d.pct, d.green, d.red
         from w,
              (values ('K-1', 'Collapsed', 'recovering', 20::numeric, null::numeric, null::numeric),
                      ('K-2', 'Back in watch', 'recovering', 75, null, null),
                      ('K-3', 'Unmeasured', 'recovering', null, null, null),
                      ('K-4', 'Thresholds', 'recovering', 50, 99.9, 99.5),
                      ('K-5', 'Untouched', 'healthy', 95, null, null))
                as d(short_id, title, state, pct, green, red)`,
    );
    const states = async () =>
      Object.fromEntries(
        (
          await client.query<{ title: string; state: string }>(
            "select title, state from kpis",
          )
        ).rows.map((row) => [row.title, row.state]),
      );

    const [result] = await runDataChanges(client, {
      scripts: [kpiRecoveringToBand],
    });
    expect(result?.rowsChanged).toBe(3);
    expect(await states()).toEqual({
      Collapsed: "unhealthy",
      "Back in watch": "watch",
      Unmeasured: "no_data",
      Thresholds: "recovering",
      Untouched: "healthy",
    });

    await client.query("delete from _data_changes");
    const [again] = await runDataChanges(client, {
      scripts: [kpiRecoveringToBand],
    });
    expect(again?.rowsChanged).toBe(0);
  });
});

describe("0022: a member's KPI is owned by that member", () => {
  it("names the member, and invents nobody for the rest", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
    await client.query(
      `with w as (
         insert into workspaces (id, name, slug)
         values (gen_random_uuid(), 'Acme', 'acme') returning id
       ), m as (
         insert into workspace_members (id, workspace_id, name, kind, status)
         select gen_random_uuid(), w.id, 'Hugo', 'human', 'active' from w
         returning id, workspace_id
       )
       insert into kpis (id, workspace_id, short_id, title, frequency,
                         owner_kind, member_id)
       select gen_random_uuid(), m.workspace_id, d.short_id, d.title,
              'monthly', d.owner_kind,
              case when d.owner_kind = 'member' then m.id end
         from m,
              (values ('K-1', 'Mine', 'member'),
                      ('K-2', 'Everybody''s', 'workspace'))
                as d(short_id, title, owner_kind)`,
    );
    const owners = async () =>
      Object.fromEntries(
        (
          await client.query<{
            title: string;
            owner_member_id: string | null;
            member_id: string | null;
          }>("select title, owner_member_id, member_id from kpis")
        ).rows.map((row) => [
          row.title,
          row.owner_member_id === row.member_id && row.owner_member_id !== null,
        ]),
      );

    const [result] = await runDataChanges(client, {
      scripts: [kpiNamedOwner],
    });
    expect(result?.rowsChanged).toBe(1);
    expect(await owners()).toEqual({ Mine: true, "Everybody's": false });

    await client.query("delete from _data_changes");
    const [again] = await runDataChanges(client, {
      scripts: [kpiNamedOwner],
    });
    expect(again?.rowsChanged).toBe(0);
  });
});

describe("0023: blockers on the check-in's clock", () => {
  it("retires the hour clock and moves open blockers to their goal's next check-in, never earlier", async () => {
    await runMigrations(client, {
      dirs: [join(import.meta.dirname, "../migrations")],
    });
    const { rows } = await client.query<{
      workspace_id: string;
      member_id: string;
      later_goal: string;
      same_day_goal: string;
    }>(
      `with w as (
         insert into workspaces (id, name, slug)
         values (gen_random_uuid(), 'Acme', 'acme') returning id
       ), r as (
         insert into rhythm_settings (workspace_id, overrides)
         select w.id, '{"cadence.blockerClockHours": 36,
                        "cadence.blockerLadderHours":
                          {"owner": 30, "coordinator": 36, "sponsor": 72},
                        "cadence.stalenessGraceDays": 2}'::jsonb
           from w
         returning workspace_id
       ), n as (
         insert into nudge_rules (id, workspace_id, rule_key, escalation_ladder)
         select gen_random_uuid(), w.id, 'blocker.escalated',
                '{"owner": 30, "coordinator": 36, "sponsor": 72}'::jsonb
           from w
         returning workspace_id
       ), m as (
         insert into workspace_members (id, workspace_id, name, kind, status)
         select gen_random_uuid(), w.id, 'Owner', 'human', 'active' from w
         returning id, workspace_id
       ), g as (
         insert into goals (id, workspace_id, title, level, owner_kind,
                            champion_id, timeframe, next_check_in_at)
         select gen_random_uuid(), m.workspace_id, d.title, 'team',
                'workspace', m.id,
                '{"start": "2026-07-01", "end": "2026-09-30"}'::jsonb,
                now() + d.ahead
           from m,
                (values ('Next week', interval '6 days'),
                        ('Today', interval '2 hours'))
                  as d(title, ahead)
         returning id, title, workspace_id
       )
       select m.workspace_id, m.id as member_id,
              (select id from g where title = 'Next week') as later_goal,
              (select id from g where title = 'Today') as same_day_goal
         from m`,
    );
    const seeded = rows[0] as {
      workspace_id: string;
      member_id: string;
      later_goal: string;
      same_day_goal: string;
    };
    // Three blockers on the old clock: an open one whose goal checks in next
    // week, a resolved one on the same goal, and an open one whose goal is
    // due before the old deadline anyway.
    await client.query(
      `insert into blockers (id, workspace_id, goal_id, type, owner_id,
                             next_action, opened_at, due_at, resolved_at,
                             source)
       values (gen_random_uuid(), $1, $2, 'resource', $4, 'Moves',
               now() - interval '1 hour', now() + interval '35 hours', null,
               'session'),
              (gen_random_uuid(), $1, $2, 'resource', $4, 'Resolved',
               now() - interval '1 hour', now() + interval '35 hours', now(),
               'session'),
              (gen_random_uuid(), $1, $3, 'resource', $4, 'Stays',
               now() - interval '1 hour', now() + interval '35 hours', null,
               'session')`,
      [
        seeded.workspace_id,
        seeded.later_goal,
        seeded.same_day_goal,
        seeded.member_id,
      ],
    );

    const [result] = await runDataChanges(client, {
      scripts: [blockerClockToCheckIn],
    });
    // One settings row, one ladder, one blocker.
    expect(result?.rowsChanged).toBe(3);

    const overrides = (
      await client.query<{ overrides: object }>(
        "select overrides from rhythm_settings where workspace_id = $1",
        [seeded.workspace_id],
      )
    ).rows[0]?.overrides;
    expect(overrides).toEqual({ "cadence.stalenessGraceDays": 2 });
    const ladder = (
      await client.query<{ escalation_ladder: object | null }>(
        "select escalation_ladder from nudge_rules where workspace_id = $1",
        [seeded.workspace_id],
      )
    ).rows[0]?.escalation_ladder;
    expect(ladder).toBeNull();

    const dues = Object.fromEntries(
      (
        await client.query<{ next_action: string; on_check_in: boolean }>(
          `select b.next_action,
                  b.due_at = g.next_check_in_at as on_check_in
             from blockers b join goals g on g.id = b.goal_id`,
        )
      ).rows.map((row) => [row.next_action, row.on_check_in]),
    );
    expect(dues).toEqual({ Moves: true, Resolved: false, Stays: false });
  });
});
