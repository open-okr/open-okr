/**
 * Whether row-level security binds the role this instance connects as
 * (completeness review H-01).
 *
 * The tenant floor is enforced by the database, so it is only as real as the
 * role the application runs as. A superuser, or a role with BYPASSRLS, is
 * never subject to a policy even when the table forces one, and the Compose
 * install connected as exactly that until the review found it. Nothing said
 * so: the product worked, which is the problem. This is how the instance says
 * so now, at boot, in the health check and on the admin screen.
 */
import { getPool } from "./pool";

export type TenantFloor = "enforced" | "bypassed";

const globals = globalThis as typeof globalThis & {
  openokrTenantFloor?: TenantFloor;
};

/** Asked once per process: the role a pool connects as does not change. */
export async function tenantFloor(): Promise<TenantFloor> {
  if (globals.openokrTenantFloor) {
    return globals.openokrTenantFloor;
  }
  const { rows } = await getPool().query<{ bypass: boolean }>(
    `select (rolsuper or rolbypassrls) as bypass
       from pg_roles
      where rolname = current_user`,
  );
  const floor: TenantFloor = rows[0]?.bypass ? "bypassed" : "enforced";
  globals.openokrTenantFloor = floor;
  return floor;
}
