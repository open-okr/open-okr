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
    columns:
      "id int primary key, company_id int, email varchar(191), name varchar(191), timezone varchar(64), status varchar(32)",
  },
  {
    name: "teams",
    columns:
      "id int primary key, company_id int, team_name varchar(191), parent_id int, leader_id int, description text, deleted_at timestamp null",
  },
  {
    name: "employee_details",
    columns:
      "id int primary key, company_id int, user_id int, designation_id bigint, reports_to int, deleted_at timestamp null",
  },
  {
    name: "performance_cycles",
    columns:
      "id int primary key, company_id int, name varchar(191), cycle_type varchar(32), type varchar(32), started_at date, finished_at date, deleted_at timestamp null",
  },
  {
    name: "objectives",
    columns:
      "id int primary key, company_id int, title varchar(191), description text, model_id int, model_type varchar(191), leader_model_id int, performance_cycle_id int, started_at date, finished_at date, weight double, result_percentage double, objective_parent_id int, key_result_parent_id int, deleted_at timestamp null",
  },
  {
    name: "key_results",
    columns:
      "id int primary key, company_id int, objective_id int, title varchar(191), description text, unit_value varchar(32), initial_value bigint, target_value bigint, current_value bigint, weight double, leader_model_id int, deleted_at timestamp null",
  },
  {
    name: "designations",
    columns: "id int primary key, company_id int, name varchar(191)",
    optional: true,
  },
  {
    name: "other_departments",
    columns: "id int primary key, user_id int, team_id int",
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
    columns:
      "id int primary key, company_id int, key_results_id int, history_value double, created_at timestamp null",
    optional: true,
  },
  {
    name: "objective_checkins",
    columns:
      "id bigint primary key, company_id int, objective_id int, user_id int, checkin_id bigint, start_date date, end_date date, confidence tinyint, current_percentage double, remarks text, created_at timestamp null",
    optional: true,
  },
  {
    name: "key_result_checkins",
    columns:
      "id bigint primary key, company_id int, key_result_id int, user_id int, checkin_id bigint, start_date date, end_date date, confidence tinyint, current_value double, remarks text, created_at timestamp null",
    optional: true,
  },
  {
    name: "checkins",
    columns: "id int primary key, company_id int",
    optional: true,
  },
  {
    name: "checkin_reviews",
    columns:
      "id bigint primary key, company_id int, user_id int, checkin_id bigint, question text, review text, created_at timestamp null",
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
  // **Objectives, one per owner class plus the shapes that cannot import.**
  // Objective 2 aligns to objective 1, which is the ordinary case; objective 5
  // aligns to objective 7, a parent with a *higher* id, which is what the
  // second pass exists for. Objective 6 has an owner class FlowyTeam itself
  // does not define, which a live instance holds fifteen of. Objective 8 sits
  // in the weekly cycle that cannot import and carries its own dates instead.
  //
  // Company ids are written out rather than bound, because which company each
  // row belongs to is the fact under test and a positional placeholder is the
  // easiest place in this file to get that wrong.
  await source.query(
    `insert into objectives
       (id, company_id, title, description, model_id, model_type, leader_model_id,
        performance_cycle_id, started_at, finished_at, weight, result_percentage,
        objective_parent_id) values
       (1, 7, 'Grow the book',      'Everything else hangs off this', 7, 'App\\\\Models\\\\Company',         1,    1, null,         null,         1, 62.5, null),
       (2, 7, 'Retain what we won', null,                             1, 'App\\\\Models\\\\Team',            2,    1, null,         null,         2, 0,    1),
       (3, 7, 'Learn the product',  null,                             2, 'App\\\\Models\\\\EmployeeDetails', 1,    1, null,         null,         1, 0,    null),
       (4, 9, 'Someone else',       null,                             9, 'App\\\\Models\\\\Company',         null, 1, null,         null,         1, 0,    null),
       (5, 7, 'Aligned to a later', null,                             7, 'App\\\\Models\\\\Company',         1,    1, null,         null,         1, 0,    7),
       (6, 7, 'Owned by nothing',   null,                             1, 'App\\\\Models\\\\User',            1,    1, null,         null,         1, 0,    null),
       (7, 7, 'The later parent',   null,                             7, 'App\\\\Models\\\\Company',         1,    1, null,         null,         1, 0,    null),
       (8, 7, 'In a weekly cycle',  null,                             7, 'App\\\\Models\\\\Company',         1,    3, '2026-01-12', '2026-01-18', 1, 0,    null),
       (9, 7, 'Rolls into a measure', null,                           7, 'App\\\\Models\\\\Company',         1,    1, null,         null,         1, 0,    null)`,
  );
  // **The pointer FlowyTeam actually uses.** `key_result_parent_id` is the
  // primary cascade pointer, and an objective rolling up into a measure rather
  // than into another objective is the ordinary case on a live instance. Set
  // in its own statement so the column list above stays readable.
  await source.query(
    "update objectives set key_result_parent_id = 1 where id = 9",
  );

  // **One key result per direction, and one that cannot be read.** The third
  // has a baseline equal to its target, which is a hold the source has no way
  // to say. The fourth belongs to an objective that does not import.
  await source.query(
    `insert into key_results
       (id, company_id, objective_id, title, unit_value, initial_value, target_value,
        current_value, weight, leader_model_id) values
       (1, 7, 1, 'New customers',   'count', 0,  40, 12, 1, 1),
       (2, 7, 1, 'Churn',           '%',     12, 4,  9,  1, null),
       (3, 7, 2, 'Keep the rating', 'stars', 5,  5,  5,  1, null),
       (4, 7, 6, 'Orphan',          null,    0,  1,  0,  1, null)`,
  );
  await source.query(
    // Key result 1 has records **and** a check-in, which is the case the
    // mapper has to choose between. Key result 3 has records only, which is the
    // ordinary older-instance shape.
    `insert into key_result_records (id, company_id, key_results_id, history_value, created_at) values
       (1, 7, 1, 5,  '2026-01-20 09:00:00'),
       (2, 7, 1, 12, '2026-02-20 09:00:00'),
       (3, 7, 3, 4,  '2026-01-20 09:00:00')`,
  );

  // **Check-ins, and the four shapes the mapper decides between.** One that
  // imports with its measures and a review, one written by somebody who did
  // not import, one with no narrative, and one on an objective that did not
  // import. Confidence is FlowyTeam's 0 to 10.
  await source.query(
    `insert into objective_checkins
       (id, company_id, objective_id, user_id, checkin_id, start_date, end_date,
        confidence, remarks, created_at) values
       (1, 7, 1, 1, 100, '2026-01-01', '2026-01-31', 8, 'Two of the three moved. The third is blocked on legal.', '2026-02-01 09:00:00'),
       (2, 7, 1, 3, 101, '2026-02-01', '2026-02-28', 3, 'Slipping.', '2026-03-01 09:00:00'),
       (3, 7, 2, 1, 102, '2026-02-01', '2026-02-28', 5, '',          '2026-03-01 09:00:00'),
       (4, 7, 6, 1, 103, '2026-02-01', '2026-02-28', 5, 'Orphan.',   '2026-03-01 09:00:00')`,
  );
  await source.query(
    `insert into key_result_checkins
       (id, company_id, key_result_id, user_id, checkin_id, start_date, end_date,
        confidence, current_value, remarks, created_at) values
       (1, 7, 1, 1, 100, '2026-01-01', '2026-01-31', 8, 18, null, '2026-02-01 09:00:00'),
       (2, 7, 2, 1, 100, '2026-01-01', '2026-01-31', 6, 7,  null, '2026-02-01 09:00:00')`,
  );
  await source.query(
    `insert into checkin_reviews (id, company_id, user_id, checkin_id, review, created_at) values
       (1, 7, 2, 100, 'Read, thank you.', '2026-02-02 10:00:00')`,
  );
  // **People, and every shape the mapper has to answer for.** One ordinary
  // person, one with a job title, one with no address at all, one belonging to
  // the other company, and one deleted employee row whose user still exists.
  await source.query(
    `insert into users (id, company_id, email, name, timezone, status) values
       (1, ?, 'ada@example.com',  'Ada Lovelace',  'Europe/London', 'active'),
       (2, ?, 'grace@example.com','Grace Hopper',  'America/New_York', 'active'),
       (3, ?, '',                 'Nobody',        null, 'active'),
       (4, ?, 'other@example.com','Someone Else',  null, 'active')`,
    [SEEDED.first.id, SEEDED.first.id, SEEDED.first.id, SEEDED.second.id],
  );
  await source.query(
    "insert into designations (id, company_id, name) values (1, ?, 'Head of Sales')",
    [SEEDED.first.id],
  );
  await source.query(
    // Employee 1 reports to user 2, so an objective they lead gets a reviewer
    // who is not themselves. Employee 2 reports to nobody, which is the case
    // §7.2 says to flag rather than invent.
    "insert into employee_details (id, company_id, user_id, designation_id, reports_to) values (1, ?, 1, 1, 2), (2, ?, 2, null, null)",
    [SEEDED.first.id, SEEDED.first.id],
  );

  // **A two-deep tree, a leader who imports, a leader who does not, and a team
  // with no name.** The depth is what §7.2 asks the report to record.
  await source.query(
    `insert into teams (id, company_id, team_name, parent_id, leader_id, description) values
       (1, ?, 'Commercial', null, 1,    'Everything that touches a customer'),
       (2, ?, 'Sales',      1,    2,    null),
       (3, ?, 'Ghosts',     null, 4,    null),
       (4, ?, '',           null, null, null)`,
    [SEEDED.first.id, SEEDED.first.id, SEEDED.first.id, SEEDED.first.id],
  );
  await source.query(
    `insert into other_departments (id, user_id, team_id) values
       (1, 2, 1),
       (2, 3, 2)`,
  );

  // **Every cycle shape the mapper decides about.** One that imports, one from
  // the Planning module, one weekly, one that ends before it starts, and two
  // that fall in the same quarter.
  await source.query(
    `insert into performance_cycles (id, company_id, name, cycle_type, type, started_at, finished_at) values
       (1, ?, 'FY26 Q1',   'quarterly', 'org',     '2026-01-05', '2026-03-31'),
       (2, ?, 'Mindmap',   'quarterly', 'mindmap', '2026-01-05', '2026-03-31'),
       (3, ?, 'Week 2',    'weekly',    'org',     '2026-01-12', '2026-01-18'),
       (4, ?, 'Backwards', 'quarterly', 'org',     '2026-06-30', '2026-04-01'),
       (5, ?, 'FY26 Q1b',  'quarterly', 'org',     '2026-02-02', '2026-03-31')`,
    [
      SEEDED.first.id,
      SEEDED.first.id,
      SEEDED.first.id,
      SEEDED.first.id,
      SEEDED.first.id,
    ],
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
