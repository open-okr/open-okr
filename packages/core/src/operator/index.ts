/**
 * The cloud operator console's domain side (P8-T03a).
 *
 * One of the two directories the boundary gate lets touch `tenants`. Design:
 * `docs/design/p8-t01b-operator-console.md`.
 */
export { readInstanceFlags } from "./flags.ts";
export { setLifecycleAsOperator } from "./lifecycle.ts";
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
export { isLiveOperator, listTenantsAsOperator } from "./store.ts";
export { measureAllWorkspaces, readUsageAsOperator } from "./usage.ts";
