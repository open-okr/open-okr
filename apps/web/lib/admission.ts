import {
  type Admission,
  resolveAdmissionLimits,
  setDefaultAdmission,
} from "@openokr/core";
import { getCache } from "./cache";
import { getPool } from "./pool";

/**
 * The instance's admission limits, resolved once at boot (P8-T06a).
 *
 * Design: `docs/design/p8-t01a-tenant-limits.md` §4 and §7.
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
  };
  setDefaultAdmission(admission);
}
