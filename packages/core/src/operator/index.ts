/**
 * The cloud operator console's domain side (P8-T03a).
 *
 * One of the two directories the boundary gate lets touch `tenants`. Design:
 * `docs/design/operator-console.md`.
 */
export {
  adoptWorkspacesAsOperator,
  countWorkspacesAwaitingAdoption,
} from "./adopt.ts";
export {
  type DefaultPlanFillResult,
  type DefaultPlanReview,
  fillDefaultPlanAsOperator,
  reviewDefaultPlanFill,
} from "./default-plan.ts";
export {
  type MarkDomainVerifiedInput,
  markDomainVerifiedAsOperator,
} from "./domains.ts";
export { readInstanceFlags } from "./flags.ts";
export {
  type GrantOutcome,
  grantOperator,
  OperatorGrantError,
  revokeOperator,
} from "./grants.ts";
export { setLifecycleAsOperator } from "./lifecycle.ts";
export {
  readWorkspaceLimitsAsOperator,
  setWorkspaceLimitsAsOperator,
} from "./limits.ts";
export { setPlanAsOperator } from "./plans.ts";
export { type CloudPreflightWarning, readCloudPreflight } from "./preflight.ts";
export {
  endSupportSession,
  grantSupportSession,
  listSupportSessions,
  liveSupportSession,
  requestSupportSession,
  sweepExpiredSessions,
} from "./sessions.ts";
export {
  createSiteMessage,
  deleteSiteMessage,
  dismissSiteMessage,
  listSiteMessages,
  liveSiteMessagesFor,
} from "./site-messages.ts";
export {
  isLiveOperator,
  listTenantsAsOperator,
  readBillingAsOperator,
} from "./store.ts";
export { setTrialAsOperator } from "./trials.ts";
export { measureAllWorkspaces, readUsageAsOperator } from "./usage.ts";
export { createWorkspaceAsOperator } from "./workspaces.ts";
