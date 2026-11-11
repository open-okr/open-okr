import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { callAction } from "../src/actions/registry.ts";
import type { CreateSSOConnectionInput } from "../src/auth/sso.ts";
import type { KeyRing } from "../src/secrets/key-ring.ts";

/**
 * Who created the workspace: the first human member, which is its owner. The
 * two writes below are audited and name an actor, so a test that only knows a
 * workspace id borrows its owner rather than inventing one.
 */
async function ownerOf(workspaceId: string): Promise<string> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ user_id: string }>(
    `select user_id from workspace_members
      where workspace_id = $1 and kind = 'human' and user_id is not null
      order by created_at limit 1`,
    [workspaceId],
  );
  const found = rows[0]?.user_id;
  if (!found) {
    throw new Error(`No human member in workspace ${workspaceId}`);
  }
  return found;
}

/**
 * A connection added the way the admin route adds one: the registered action,
 * as the workspace's owner. Same signature the unaudited helper had, so the
 * tests that only need a connection to exist keep reading the same.
 */
export async function createSSOConnection(
  pool: Pool,
  workspaceId: string,
  ring: KeyRing,
  input: CreateSSOConnectionInput,
  baseUrl: string,
): Promise<{ id: string; providerId: string }> {
  return callAction(
    {
      pool,
      workspaceId,
      actor: { kind: "human", userId: await ownerOf(workspaceId) },
      ring,
      baseUrl,
      checkOutboundUrl: async () => ({ ok: true }),
    },
    "sso.createConnection",
    input,
  );
}

/** A directory token minted through `directory.createToken`, as the owner. */
export async function createSCIMToken(
  pool: Pool,
  workspaceId: string,
  label?: string,
): Promise<{ token: string; id: string }> {
  return callAction(
    {
      pool,
      workspaceId,
      actor: { kind: "human", userId: await ownerOf(workspaceId) },
    },
    "directory.createToken",
    label === undefined ? {} : { label },
  );
}
