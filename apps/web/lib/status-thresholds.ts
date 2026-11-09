import {
  resolveStatusThresholds,
  type StatusThresholds,
  statusThresholdsFrom,
} from "@openokr/core";
import { getPool } from "./pool";

/**
 * The `/api/status` thresholds, resolved once at boot (plan 0.7.0 P8,
 * docs/design/status-and-capacity.md §4).
 *
 * The same arrangement as `installAdmission`: the endpoint answers every
 * probe, so it reads what boot resolved rather than `system_settings`. A
 * change to a stored threshold takes effect at the next restart, which is the
 * trade `lib/admission.ts` records for the same reason.
 */
let installed: StatusThresholds | undefined;

export async function installStatusThresholds(): Promise<void> {
  installed = await resolveStatusThresholds(getPool());
}

/**
 * What boot installed. Before boot, or in a process that never ran it, the
 * environment and the registry's defaults, validated the same way.
 */
export function statusThresholds(): StatusThresholds {
  installed ??= statusThresholdsFrom({});
  return installed;
}
