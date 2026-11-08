/**
 * A signed-in person starting another workspace (docs/design/hosting-profiles.md §3).
 *
 * **The same door as sign-up.** Somebody who could have signed up and got a
 * workspace may start one now, by the one function that answers that question.
 * Nothing else is a new rule: under an invitation-only policy a workspace comes
 * from whoever runs the instance, however signed in the person asking is.
 */
import { users } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { OperationError } from "../operations/operation.ts";
import { requireFreeWorkspaceRoom } from "../tenancy/index.ts";
import { createWorkspace, type ProvisionedWorkspace } from "./provisioning.ts";
import { registrationRefusal } from "./registration.ts";

type Environment = Record<string, string | undefined>;

/** Whether this address may start a workspace here, before anybody fills in a form. */
export async function mayCreateOwnWorkspace(
  pool: Pool,
  email: string,
  environment: Environment = process.env,
): Promise<boolean> {
  return (await registrationRefusal(pool, null, email, environment)) === null;
}

export async function createOwnWorkspace(
  pool: Pool,
  input: {
    readonly userId: string;
    readonly name?: string;
    readonly timezone?: string;
  },
  environment: Environment = process.env,
): Promise<ProvisionedWorkspace> {
  const [user] = await drizzle(pool)
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!user) {
    throw new OperationError(
      "forbidden",
      "Sign in before starting a workspace.",
    );
  }
  if (!(await mayCreateOwnWorkspace(pool, user.email, environment))) {
    throw new OperationError(
      "forbidden",
      "Workspaces on this instance are created by whoever runs it.",
    );
  }

  // The count and the insert are two transactions, so the same lock sign-up
  // holds keeps two tabs from both finding room for one more.
  const guard = await pool.connect();
  try {
    await guard.query("select pg_advisory_lock(hashtext($1))", [
      `provision:${user.id}`,
    ]);
    await requireFreeWorkspaceRoom(pool, user.id);
    return await createWorkspace(pool, {
      user: { id: user.id, name: user.name },
      ...(input.name ? { name: input.name } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
    });
  } finally {
    await guard
      .query("select pg_advisory_unlock(hashtext($1))", [
        `provision:${user.id}`,
      ])
      .catch(() => undefined);
    guard.release();
  }
}
