/**
 * Reading a workspace's audit chain back out and checking it
 * (TECHNICAL-PLAN §8.2, "a verification tool").
 *
 * The read runs inside the tenant floor like every other read, so verifying
 * one workspace cannot see another's rows.
 */
import { auditEvents, withWorkspace } from "@openokr/db";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type AuditRow, type ChainVerdict, verifyChain } from "./chain.ts";

/**
 * Verifies one workspace's chain from the database.
 *
 * Reads every row rather than sampling: a chain that is only spot-checked is a
 * chain nobody has verified. Workspaces large enough for that to matter get a
 * streaming verifier when P7-T01 measures one.
 */
export async function verifyWorkspaceChain(
  pool: Pool,
  workspaceId: string,
): Promise<ChainVerdict> {
  const db = drizzle(pool);
  const rows = await withWorkspace(db, workspaceId, (tx) =>
    tx.select().from(auditEvents).orderBy(asc(auditEvents.seq)),
  );

  return verifyChain(
    rows.map((row) => ({
      workspaceId: row.workspaceId,
      seq: Number(row.seq),
      actorMemberId: row.actorMemberId,
      actorKind: row.actorKind,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      payload: row.payload,
      at: row.at,
      prevHash: row.prevHash,
      rowHash: row.rowHash,
    })) satisfies (AuditRow & { rowHash: string })[],
  );
}

/**
 * Can this connection see every workspace?
 *
 * The tenant floor hides workspaces from anybody with no workspace setting
 * applied, and `force row level security` means that includes the role that
 * owns the tables. Only a superuser or a role with BYPASSRLS can enumerate
 * tenants, which is the right bar for an operator tool and the wrong thing to
 * discover by getting an empty list back.
 */
export async function canEnumerateWorkspaces(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ elevated: boolean }>(
    "select (rolsuper or rolbypassrls) as elevated from pg_roles where rolname = current_user",
  );
  return result.rows[0]?.elevated === true;
}

/** Raised when the tool cannot see what it was asked to check. */
export class AuditVisibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditVisibilityError";
  }
}

/**
 * Verifies every workspace on the instance. Used by `pnpm audit:verify` and by
 * the Phase 1 exit checklist.
 *
 * Refuses rather than returning an empty list when the connection cannot
 * enumerate tenants. An audit verifier that reports success because it could
 * not see anything is worse than no verifier at all: it is a green light
 * nobody has earned.
 */
export async function verifyAllChains(
  pool: Pool,
): Promise<{ workspaceId: string; verdict: ChainVerdict }[]> {
  if (!(await canEnumerateWorkspaces(pool))) {
    throw new AuditVisibilityError(
      "This database role cannot list workspaces: the tenant floor hides them, " +
        "and forced row-level security applies to the table owner too. " +
        "Connect as a maintenance role with BYPASSRLS, or name the workspaces " +
        "to check as arguments.",
    );
  }

  const workspaces = await pool.query<{ id: string }>(
    "select id from workspaces order by created_at",
  );

  const results: { workspaceId: string; verdict: ChainVerdict }[] = [];
  for (const workspace of workspaces.rows) {
    results.push({
      workspaceId: workspace.id,
      verdict: await verifyWorkspaceChain(pool, workspace.id),
    });
  }
  return results;
}
