/**
 * Connection facts for the test database stack in `docker/compose.yaml`.
 *
 * These are test-only variables with working defaults that match the compose
 * file, so a local checkout runs `pnpm db:up` and nothing else. They are
 * deliberately not part of the `@openokr/config` runtime schema: the product
 * never reads them.
 */

const env = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
};

export const testDbEnv = {
  host: env("TEST_DB_HOST", "localhost"),
  /** Postgres, direct. */
  port: Number(env("TEST_DB_PORT", "55432")),
  /** PgBouncer in transaction pooling mode, in front of the same Postgres. */
  pgbouncerPort: Number(env("TEST_PGBOUNCER_PORT", "56432")),
  superuser: env("TEST_DB_SUPERUSER", "postgres"),
  /** One throwaway password for every test role; see docker/userlist.txt. */
  password: env("TEST_DB_PASSWORD", "postgres"),
  templateDatabase: "openokr_test_template",
  /** Fixed-name database served by a single PgBouncer server connection. */
  spikeLeakDatabase: "openokr_spike_leak",
  ownerRole: "openokr_owner",
  appRole: "openokr_app",
} as const;

/**
 * The FlowyTeam source the importer's connector tests read (P6-T02).
 *
 * **A second server, and test-only like the first.** The product needs Postgres
 * and nothing else; MySQL is here because the one source system this importer
 * reads runs on it, and the acceptance criterion is that the connector
 * provably cannot write to a real one. A fake connection cannot prove that: it
 * would be this repository asserting its own belief about what MySQL does with
 * `SET SESSION TRANSACTION READ ONLY`.
 *
 * `TEST_MYSQL_PORT` points the suite at a MySQL you already run, exactly as
 * `TEST_DB_PORT` does for Postgres. The connector's tests skip themselves with
 * a sentence when nothing answers, so a checkout without the stack still runs
 * every other suite.
 */
export const testMysqlEnv = {
  host: env("TEST_MYSQL_HOST", "localhost"),
  port: Number(env("TEST_MYSQL_PORT", "53306")),
  user: env("TEST_MYSQL_USER", "root"),
  /**
   * Read directly rather than through `env`, because an empty password is a
   * real answer here and `env` treats empty as unset. A locally installed MySQL
   * very often has a root account with no password at all, and
   * `TEST_MYSQL_PASSWORD=` is how somebody says so.
   */
  password: process.env.TEST_MYSQL_PASSWORD ?? "mysql",
} as const;

/** A `mysql://` address for a database on the test MySQL. */
export const mysqlUrl = (database: string): string => {
  const auth =
    testMysqlEnv.password === ""
      ? encodeURIComponent(testMysqlEnv.user)
      : `${encodeURIComponent(testMysqlEnv.user)}:${encodeURIComponent(testMysqlEnv.password)}`;
  return `mysql://${auth}@${testMysqlEnv.host}:${testMysqlEnv.port}/${database}`;
};

export const connectionOptions = (
  database: string,
  user: string,
  port?: number,
) => ({
  host: testDbEnv.host,
  port: port ?? testDbEnv.port,
  user,
  password: testDbEnv.password,
  database,
});
