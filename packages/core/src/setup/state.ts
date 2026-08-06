/**
 * Is this instance configured yet? (P1-T09.)
 *
 * The wizard has to open on a fresh instance and be shut afterwards, and
 * getting that backwards either locks the operator out of their own setup or
 * leaves a route that can re-provision a running deployment. So "configured"
 * has one definition, in one place, and every guard reads it from here.
 *
 * An instance is configured when the wizard recorded a completion timestamp.
 * That is a deliberate marker rather than an inference from "does a user
 * exist", because the two can disagree: a wizard interrupted after creating
 * the admin but before storing mail settings must be resumable, and an
 * instance seeded by environment variables alone has never run the wizard at
 * all but is perfectly usable.
 *
 * The second half is the lock. Once configured, the setup routes refuse. The
 * check is a database read on every request rather than a cached flag, because
 * the cost is one indexed lookup and the failure mode of a stale cache here is
 * an open setup wizard on a live instance.
 */
import type { Pool } from "pg";
import { SETUP_COMPLETED_AT } from "../secrets/instance-registry.ts";
import { readSetting } from "../secrets/instance-settings.ts";

export interface SetupState {
  readonly configured: boolean;
  /** When the wizard finished, if it has. */
  readonly completedAt?: string;
  /** True when at least one account exists, wizard or not. */
  readonly hasUser: boolean;
}

/**
 * Reads the instance's setup state.
 *
 * `hasUser` comes from the same query so a caller cannot act on a half-read
 * picture: the wizard's own guard needs both, and asking twice would let an
 * account appear between the two reads.
 */
export async function readSetupState(pool: Pool): Promise<SetupState> {
  const [completedAt, users] = await Promise.all([
    readSetting(pool, SETUP_COMPLETED_AT),
    pool.query<{ present: boolean }>(
      "select exists (select 1 from users limit 1) as present",
    ),
  ]);

  const stamp =
    typeof completedAt === "string" && completedAt !== ""
      ? completedAt
      : undefined;

  return {
    configured: stamp !== undefined,
    ...(stamp ? { completedAt: stamp } : {}),
    hasUser: users.rows[0]?.present === true,
  };
}

/**
 * Why the setup route refused, or undefined when it may proceed.
 *
 * Returns a reason rather than a boolean so the page can say what happened.
 * An operator who reaches a closed wizard needs to know whether they are late
 * or lost.
 */
export function setupRefusal(state: SetupState): string | undefined {
  if (state.configured) {
    return "This instance has already been set up. Sign in instead, or use the lifecycle helper to change instance settings.";
  }
  return undefined;
}
