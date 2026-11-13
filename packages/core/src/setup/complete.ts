/**
 * Finishing the first-run wizard (P1-T09).
 *
 * The wizard's last step has to be safe to interrupt and safe to repeat, so
 * the order matters more than it looks:
 *
 *   1. take the instance lock, so two browser tabs cannot both claim it
 *   2. re-read the setup state inside the lock
 *   3. store the instance settings
 *   4. record completion
 *
 * The admin account is created before this by Better Auth, through the same
 * registration path everybody else uses, which is why there is no password
 * handling anywhere in this file. The wizard collects the account details and
 * hands them to Better Auth; a hard rule says authentication goes through it
 * only, and a setup wizard is not an exception to that.
 *
 * Completion is recorded last on purpose. A wizard interrupted between step 3
 * and step 4 leaves an instance with its settings stored and no completion
 * marker, so it reopens and finishes the job. The reverse order would leave a
 * closed wizard on an instance that was never configured, and no way back in.
 */
import type { Pool } from "pg";
import { SETUP_COMPLETED_AT } from "../secrets/instance-registry.ts";
import {
  type SettingWrite,
  writeSettings,
} from "../secrets/instance-settings.ts";
import type { KeyRing } from "../secrets/key-ring.ts";
import { clearSetupCode } from "./setup-code.ts";
import { readSetupState } from "./state.ts";

export interface CompleteSetupInput {
  /** Instance settings gathered by the wizard. */
  readonly settings: readonly SettingWrite[];
  // No registration policy is written here any more (registration-policy.md
  // §9 D11, plan 0.7.0 B1). The computed default already closes a claimed
  // self-hosted instance, a cloud stays open, and OPENOKR_REGISTRATION keeps
  // working after setup. The saved `invite_only` this used to write did the
  // opposite of all three.
  readonly now?: () => Date;
  /** Where a generated setup code's file lives. Tests only; absent reads the environment. */
  readonly storageRoot?: string;
}

export interface CompleteSetupResult {
  readonly completedAt: string;
  /** True when this call finished setup, false when it was already done. */
  readonly claimed: boolean;
}

/** Serialises the claim across processes, not just across requests. */
const SETUP_LOCK = "openokr:setup";

export async function completeSetup(
  pool: Pool,
  ring: KeyRing,
  input: CompleteSetupInput,
): Promise<CompleteSetupResult> {
  const now = input.now ?? (() => new Date());
  const guard = await pool.connect();

  try {
    await guard.query("select pg_advisory_lock(hashtext($1))", [SETUP_LOCK]);

    // Re-read inside the lock. Checking before taking it would let two
    // wizards both see an unconfigured instance and both claim it.
    const state = await readSetupState(pool);
    if (state.configured) {
      return {
        completedAt: state.completedAt ?? "",
        claimed: false,
      };
    }

    const completedAt = now().toISOString();
    const writes: SettingWrite[] = [
      ...input.settings.map((setting) => ({
        ...setting,
        source: setting.source ?? ("wizard" as const),
      })),
    ];

    // Settings first, completion last: an interrupted wizard reopens rather
    // than locking the operator out of an unconfigured instance.
    await writeSettings(pool, ring, writes);
    await writeSettings(pool, ring, [
      { key: SETUP_COMPLETED_AT, value: completedAt, source: "wizard" },
    ]);

    // The code is dead the moment setup is recorded, so its hash and file go
    // in the same step (setup-code.md D10). After completion on purpose: the
    // hook that read it reads only an unclaimed instance, so a failure here
    // leaves a dead row at worst, and never a closed wizard with no way in.
    await clearSetupCode(pool, input.storageRoot).catch((error: unknown) => {
      process.stderr.write(
        `setup: could not remove the setup code: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });

    return { completedAt, claimed: true };
  } finally {
    // A session-level lock outlives its transaction and would travel with the
    // connection to whoever takes it from the pool next.
    await guard
      .query("select pg_advisory_unlock(hashtext($1))", [SETUP_LOCK])
      .catch(() => undefined);
    guard.release();
  }
}
