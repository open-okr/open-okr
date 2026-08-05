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
