/**
 * The tenancy module (P8-T02a).
 *
 * The one place `tenants` may be read or written outside the operator
 * console. Design: `docs/design/p8-t01a-tenant-lifecycle.md`.
 *
 * Only what somebody actually calls is re-exported here. The types travel
 * with their own modules until a consumer outside this directory needs one,
 * because `pnpm dead-code` refuses an export nothing imports and a barrel
 * that re-exports everything is how that gate stops meaning anything.
 */

export {
  type Admission,
  AdmissionError,
  type AdmissionLimits,
  AdmissionSettingError,
  setDefaultAdmission,
} from "./admission.ts";
export { setTenantStateInTx } from "./lifecycle.ts";
export {
  countSeats,
  readOwnUsage,
  readPlans,
  seatState,
} from "./plans.ts";
export {
  CLOUD_CLOSURE_RETENTION_KEY,
  CLOUD_ENABLED_KEY,
  CLOUD_REGION_KEY,
  isCloudEnabled,
  resolveAdmissionLimits,
  resolveCloudTenancy,
} from "./settings.ts";
export { readTenant, seedTenantInTx } from "./store.ts";
export { sweepClosedTenants } from "./sweep.ts";
