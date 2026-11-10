import {
  type Admission,
  planLimitsFor,
  resolveAdmissionLimits,
  setDefaultAdmission,
} from "@openokr/core";
import { getCache } from "./cache";
import { getPool } from "./pool";

const globals = globalThis as typeof globalThis & {
  openokrOutboxRowsPerMinute?: number;
};

/**
 * The outbox rate per workspace, as boot resolved it (docs/design/
 * tenant-limits.md §10, plan 0.7.0 P6 and P7). Zero, unlimited, until then
 * and on every instance that sets none. The relay reads this on every claim
 * and the status check on every request, so neither depends on boot order.
 */
export function outboxRowsPerMinute(): number {
  return globals.openokrOutboxRowsPerMinute ?? 0;
}

/**
 * The instance's admission limits, resolved once at boot (P8-T06a).
 *
 * Design: `docs/design/tenant-limits.md` §4 and §7.
 *
 * **Resolved here rather than per call, because reading a setting is a
 * database read.** Admission runs on every action from every surface, so
 * resolving inside it would cost the connection the whole design exists to
 * protect: a limiter that takes a pool slot to decide it should not have
 * taken a pool slot has not limited anything.
 *
 * **A change takes effect on the next restart, and that is a real
 * limitation.** `resolveSignupPolicy` resolves at boot for the same reason
 * and it is the same trade. An operator who lowers a limit to stop a burst
 * that is happening now will not see it engage until the processes cycle.
 * Recorded rather than designed around: making it live means either a read
 * per call, which is the thing being avoided, or a cache with its own
 * invalidation, which is a mechanism nobody has asked for yet.
 *
 * **The counters are the cache driver, passed structurally.**
 * `packages/core` may not import `packages/adapters`, so it declares the two
 * methods it needs and this file hands over the driver the instance already
 * built. That is the Postgres cache, on the application's own pool, so a
 * refusal costs one short indexed upsert rather than the nothing the design
 * document claims; `packages/core/src/tenancy/admission.ts` says so at
 * length.
 */
export async function installAdmission(): Promise<void> {
  const limits = await resolveAdmissionLimits(getPool());

  // Installed even when both limits are zero, which is every self-hosted
  // instance. `admit` returns on two comparisons in that case, and having
  // the branch present rather than absent is the arrangement §7 asks for:
  // the absent branch is the one nobody tests.
  const admission: Admission = {
    ...limits,
    counters: getCache(),
    limitsFor: cachedPlanLimits,
  };
  setDefaultAdmission(admission);
  // Validated with the other two by `resolveAdmissionLimits`, so a number
  // below the floor has already stopped the boot with a sentence.
  globals.openokrOutboxRowsPerMinute = limits.outboxRowsPerMinute ?? 0;
}

/** How long a workspace's plan limits are trusted before they are read again. */
const PLAN_LIMITS_SECONDS = 60;

const planLimits = new Map<
  string,
  {
    readonly at: number;
    readonly limits: Awaited<ReturnType<typeof planLimitsFor>>;
  }
>();

/**
 * A workspace's plan limits (plan 0.7.0 P5), read at most once a minute per
 * workspace, so admission still costs no database read per action. A plan
 * change reaches admission within the minute. A read that fails leaves the
 * instance's limits in force rather than refusing the action.
 */
async function cachedPlanLimits(
  workspaceId: string,
): Promise<Awaited<ReturnType<typeof planLimitsFor>>> {
  const now = Date.now();
  const held = planLimits.get(workspaceId);
  if (held && now - held.at < PLAN_LIMITS_SECONDS * 1000) {
    return held.limits;
  }
  const limits = await planLimitsFor(getPool(), workspaceId).catch(() => null);
  planLimits.set(workspaceId, { at: now, limits });
  return limits;
}
