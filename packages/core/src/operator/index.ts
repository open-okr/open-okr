/**
 * The cloud operator console's domain side (P8-T03a).
 *
 * One of the two directories the boundary gate lets touch `tenants`. Design:
 * `docs/design/p8-t01b-operator-console.md`.
 */
export { isLiveOperator, listTenantsAsOperator } from "./store.ts";
export { measureAllWorkspaces, readUsageAsOperator } from "./usage.ts";
