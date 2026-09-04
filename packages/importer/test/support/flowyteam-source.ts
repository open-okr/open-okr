/**
 * A throwaway FlowyTeam-shaped MySQL, for the connector's tests (P6-T02).
 *
 * **A real server, not a fake.** The one thing this connector has to prove is
 * that it cannot write to a source, and the proof is MySQL refusing a real
 * insert with its own error code. A fake connection would only assert this
 * repository's belief about what `SET SESSION TRANSACTION READ ONLY` does.
 *
 * **A schema of its own, not a dump.** The tables here carry the columns the
 * connector reads and nothing else: FlowyTeam's own `objectives` has thirty and
 * this needs four. A dump would be a second schema to keep current, and the
 * connector deliberately reads through `information_schema` and a handful of
 * named columns rather than assuming a shape.
 *
 * **`TEST_MYSQL_PORT` points it at a server you already run**, the same way
 * `TEST_DB_PORT` does for Postgres. Without one, `available()` answers false
 * and the suites skip themselves with a sentence rather than failing.
 */
import { mysqlUrl, testMysqlEnv } from "@openokr/test-support/db-env";
// openokr:allow-vendor-sdk: the test harness for the one pre-approved importer
// dependency. It opens the throwaway database as an administrator, which is
// exactly what the connector under test must never be able to do.
import mysql from "mysql2/promise";

/** Companies the seed creates, so a test can assert against them by name. */
export const SEEDED = {
  first: { id: 7, name: "Northwind Trading" },
  second: { id: 9, name: "Contoso Manufacturing" },
} as const;

/** The migration rows the seed applies, newest last. */
const MIGRATIONS = [
  "2019_12_26_174126_create_performance_settings_table",
  "2023_04_11_000001_change_key_result_values_to_bigint",
  "2026_07_14_000001_add_client_secret_plain_to_oauth_clients_table",
];

/**
 * Every table the connector expects, with the columns it reads.
 *
 * `optional` names the ones a real older instance can be missing:
 * `flowy_prod`, a live FlowyTeam this connector was written against, has no
 * discussion tables. A test drops them to reproduce that instance.
 */
const TABLES: readonly { name: string; columns: string; optional?: true }[] = [
  {
    name: "migrations",
    columns:
      "id int auto_increment primary key, migration varchar(255) not null, batch int not null default 1",
  },
  {
    name: "companies",
    columns:
      "id int primary key, company_name varchar(191), company_username varchar(191), timezone varchar(64), status varchar(32)",
  },
  {
    name: "users",
    columns: "id int primary key, company_id int, email varchar(191)",
  },
  {
    name: "teams",
    columns:
      "id int primary key, company_id int, team_name varchar(191), parent_id int",
  },
  {
    name: "employee_details",
    columns: "id int primary key, company_id int, user_id int",
  },
  {
    name: "performance_cycles",
    columns: "id int primary key, company_id int, name varchar(191)",
  },
  {
    name: "objectives",
    columns:
      "id int primary key, company_id int, title varchar(191), deleted_at timestamp null",
  },
  {
    name: "key_results",
    columns:
      "id int primary key, company_id int, objective_id int, title varchar(191)",
  },
  {
    name: "designations",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "other_departments",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "employee_teams",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "performance_settings",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "indicator_types",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "indicators",
    columns: "id int primary key, company_id int, title varchar(191)",
    optional: true,
  },
  {
    name: "indicator_records",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "indicator_calculates",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "indicator_accesses",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "keyresult_indicator",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "key_result_records",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "objective_checkins",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "key_result_checkins",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "checkins",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "checkin_reviews",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "objective_accesses",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "objective_discussions",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "keyresult_discussions",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "key_result_files",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "task_boards",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "taskboard_columns",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "task_category",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "tasks",
    columns: "id int primary key, company_id int, heading varchar(191)",
    optional: true,
  },
  {
    name: "sub_tasks",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "tasks_accesses",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "task_comments",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "task_files",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "reward_settings",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "scores",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "performance_records",
    columns: "id int primary key, company_id int",
    optional: true,
  },
];

let reachable: boolean | null = null;

/** Whether a MySQL answers at all. Cached: a refused connection takes a second. */
export async function available(): Promise<boolean> {
  if (reachable !== null) {
    return reachable;
  }
  try {
    const admin = await connect();
    await admin.end();
    reachable = true;
  } catch {
    reachable = false;
  }
  return reachable;
}

export const SKIP_REASON = `No MySQL at ${testMysqlEnv.host}:${testMysqlEnv.port}. Start the test stack with "pnpm db:up", or point TEST_MYSQL_PORT at a server you already run.`;

async function connect(database?: string): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: testMysqlEnv.host,
    port: testMysqlEnv.port,
    user: testMysqlEnv.user,
    password: testMysqlEnv.password,
    ...(database ? { database } : {}),
    connectTimeout: 5_000,
  });
}

export interface SeededSource {
  readonly database: string;
  readonly url: string;
  /** Runs a statement as an administrator, which the connector cannot. */
  run(sql: string, values?: readonly unknown[]): Promise<void>;
  drop(): Promise<void>;
}

/**
 * A fresh database with the FlowyTeam shape and two companies in it.
 *
 * `without` drops the named tables after seeding, which is how a test
 * reproduces a real older instance rather than describing one.
 */
export async function seedSource(
  name: string,
  options: { readonly without?: readonly string[] } = {},
): Promise<SeededSource> {
  const database = `openokr_flowy_${name}`;
  const admin = await connect();
  await admin.query(`drop database if exists \`${database}\``);
  await admin.query(`create database \`${database}\``);
  await admin.end();

  const source = await connect(database);
  const dropped = new Set(options.without ?? []);
  for (const table of TABLES) {
    if (dropped.has(table.name)) {
      continue;
    }
    await source.query(
      `create table \`${table.name}\` (${table.columns}) engine=InnoDB`,
    );
  }

  for (const migration of MIGRATIONS) {
    await source.query("insert into migrations (migration) values (?)", [
      migration,
    ]);
  }
  for (const company of [SEEDED.first, SEEDED.second]) {
    await source.query(
      "insert into companies (id, company_name, company_username, timezone, status) values (?, ?, ?, ?, ?)",
      [company.id, company.name, `c${company.id}`, "Asia/Jakarta", "active"],
    );
  }
  // Two objectives and three key results for the first company, one objective
  // for the second, so a count that ignored `company_id` would be visibly wrong
  // rather than plausibly wrong.
  await source.query(
    "insert into objectives (id, company_id, title) values (1, ?, 'Grow'), (2, ?, 'Retain'), (3, ?, 'Someone else')",
    [SEEDED.first.id, SEEDED.first.id, SEEDED.second.id],
  );
  await source.query(
    "insert into key_results (id, company_id, objective_id, title) values (1, ?, 1, 'A'), (2, ?, 1, 'B'), (3, ?, 2, 'C')",
    [SEEDED.first.id, SEEDED.first.id, SEEDED.first.id],
  );
  await source.query(
    "insert into teams (id, company_id, team_name) values (1, ?, 'Sales')",
    [SEEDED.first.id],
  );
  await source.query(
    "insert into employee_details (id, company_id, user_id) values (1, ?, 1)",
    [SEEDED.first.id],
  );
  await source.query(
    "insert into performance_cycles (id, company_id, name) values (1, ?, 'Q1')",
    [SEEDED.first.id],
  );
  if (!dropped.has("indicators")) {
    await source.query(
      "insert into indicators (id, company_id, title) values (1, ?, 'Revenue')",
      [SEEDED.first.id],
    );
  }
  if (!dropped.has("tasks")) {
    await source.query(
      "insert into tasks (id, company_id, heading) values (1, ?, 'Call back')",
      [SEEDED.first.id],
    );
  }
  await source.end();

  return {
    database,
    url: mysqlUrl(database),
    async run(sql, values) {
      const connection = await connect(database);
      try {
        await connection.query(sql, values ? [...values] : []);
      } finally {
        await connection.end();
      }
    },
    async drop() {
      const cleanup = await connect();
      try {
        await cleanup.query(`drop database if exists \`${database}\``);
      } finally {
        await cleanup.end();
      }
    },
  };
}
