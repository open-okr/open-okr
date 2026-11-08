/**
 * The tenancy module (P8-T02a).
 *
 * The one place `tenants` may be read or written outside the operator
 * console. Design: `docs/design/tenant-lifecycle.md`.
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
  currentConcurrentActions,
  setDefaultAdmission,
} from "./admission.ts";
export { adoptWorkspaces } from "./adopt.ts";
export {
  type ClosureSchedule,
  closingOutbox,
  erasureDateFor,
  readClosureSchedule,
  remindBeforeErasure,
} from "./closing.ts";
export {
  addCreditPackInTx,
  type CreditSummary,
  chargeCreditsInTx,
  creditsPausedReason,
  creditValueUsd,
  type HostedAccess,
  readCreditSummary,
  readHostedAccess,
} from "./credits.ts";
export {
  readLifecycleInTx,
  readWorkspaceLifecycle,
  refuseOwnLifecycleMove,
  refuseOwnStateChange,
  setTenantStateInTx,
  type TenantLifecycle,
} from "./lifecycle.ts";
export {
  applyPlanInTx,
  countSeats,
  hasPlanScreen,
  listSeatHolders,
  type Plan,
  planByKey,
  readOwnPlan,
  readOwnUsage,
  readPlans,
  requireFreeWorkspaceRoom,
  resolveDefaultPlan,
  seatState,
  seatsInUseInTx,
} from "./plans.ts";
export {
  CLOUD_CLOSURE_RETENTION_KEY,
  CLOUD_ENABLED_KEY,
  CLOUD_REGION_KEY,
  guardsAIEndpoints,
  isCloudEnabled,
  resolveAdmissionLimits,
  resolveCloudTenancy,
} from "./settings.ts";
export { readTenant, seedTenantInTx } from "./store.ts";
export { sweepClosedTenants } from "./sweep.ts";
