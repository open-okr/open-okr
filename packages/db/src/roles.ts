/**
 * Database role provisioning (TECHNICAL-PLAN §8.2).
 *
 * Two roles, one boundary:
 *  - The owner role owns the schema and runs migrations. Nothing else.
 *  - The application role reads and writes data and can never bypass
 *    row-level security, because it neither owns the tables nor holds
 *    BYPASSRLS. Together with FORCE ROW LEVEL SECURITY on every business
 *    table, the tenant floor holds even against raw SQL.
 *
 * Used by the test harness today and by the setup wizard in P1-T09.
 */

/** Something that can run a query: a pg Client or Pool, without importing pg. */
export interface SqlRunner {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface EnsureRolesOptions {
  readonly ownerRole: string;
  readonly appRole: string;
  /** One password for both roles. Test infrastructure only; the setup wizard
   * generates distinct secrets per role. */
  readonly password: string;
}

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Creates the owner and application roles if they are missing. Idempotent. */
export async function ensureRoles(
  client: SqlRunner,
  options: EnsureRolesOptions,
): Promise<void> {
  for (const role of [options.ownerRole, options.appRole]) {
    if (!ROLE_NAME.test(role)) {
      throw new Error(`Invalid role name: ${JSON.stringify(role)}`);
    }
  }
  // Identifiers cannot be bound parameters; names are validated above and the
  // password is quoted by doubling, the escape rule SQL string literals use.
  const password = options.password.replace(/'/g, "''");

  await client.query(`
    do $$
    begin
      if not exists (select from pg_roles where rolname = '${options.ownerRole}') then
        create role ${options.ownerRole}
          login password '${password}'
          nosuperuser nobypassrls nocreatedb nocreaterole;
      end if;
      if not exists (select from pg_roles where rolname = '${options.appRole}') then
        create role ${options.appRole}
          login password '${password}'
          nosuperuser nobypassrls nocreatedb nocreaterole;
      end if;
    end
    $$;
  `);
}
