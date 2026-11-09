/**
 * S-45's search and filters (UIUX-PLAN S-45, operator-console.md §8): search
 * by name or slug, filter by state and by plan.
 *
 * **They live in the address, and the page filters the list it already
 * read.** The list is the operator's own policy-scoped read, every tenant on
 * the instance in one query, so filtering it here returns nothing the page
 * would not have shown anyway. A filter in the address is one an operator can
 * paste into a ticket, and the form works without JavaScript.
 */

export const TENANT_STATES = ["active", "suspended", "closed"] as const;
export type TenantStateFilter = (typeof TENANT_STATES)[number];

/** The same limit the search box sets as `maxLength`. */
export const WORKSPACE_SEARCH_MAX = 200;

/**
 * No plan, or one plan by key.
 *
 * A plan key is any string an operator chose, "none" included, so the value
 * in the address carries a prefix rather than sharing one namespace with a
 * sentinel.
 */
type PlanFilter =
  | { readonly kind: "none" }
  | { readonly kind: "key"; readonly key: string };

interface WorkspaceListFilter {
  readonly query: string;
  readonly state: TenantStateFilter | null;
  readonly plan: PlanFilter | null;
}

type Param = string | readonly string[] | undefined;

function first(value: Param): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const NO_PLAN = "none";
const KEY_PREFIX = "key:";

/** What a plan option sends: `none`, or `key:` and the plan's key. */
export function planFilterValue(planKey: string | null): string {
  return planKey === null ? NO_PLAN : `${KEY_PREFIX}${planKey}`;
}

/**
 * Reads the filter from the page's search parameters.
 *
 * Anything it does not recognise reads as no filter on that axis rather than
 * as a guess, so a stale or hand-edited link shows more, never less.
 */
export function readWorkspaceFilter(params: {
  readonly q?: Param;
  readonly state?: Param;
  readonly plan?: Param;
}): WorkspaceListFilter {
  const query = first(params.q).trim().slice(0, WORKSPACE_SEARCH_MAX);
  const stateValue = first(params.state);
  const state = (TENANT_STATES as readonly string[]).includes(stateValue)
    ? (stateValue as TenantStateFilter)
    : null;
  const planValue = first(params.plan);
  const plan: PlanFilter | null =
    planValue === NO_PLAN
      ? { kind: "none" }
      : planValue.startsWith(KEY_PREFIX) && planValue.length > KEY_PREFIX.length
        ? { kind: "key", key: planValue.slice(KEY_PREFIX.length) }
        : null;
  return { query, state, plan };
}

export function isFiltered(filter: WorkspaceListFilter): boolean {
  return filter.query !== "" || filter.state !== null || filter.plan !== null;
}

interface FilterableWorkspace {
  readonly name: string;
  readonly slug: string;
  readonly tenantState: string;
  readonly planKey: string | null;
}

export function filterWorkspaces<Row extends FilterableWorkspace>(
  rows: readonly Row[],
  filter: WorkspaceListFilter,
): Row[] {
  const needle = filter.query.toLowerCase();
  return rows.filter((row) => {
    if (
      needle !== "" &&
      !row.name.toLowerCase().includes(needle) &&
      !row.slug.toLowerCase().includes(needle)
    ) {
      return false;
    }
    if (filter.state !== null && row.tenantState !== filter.state) {
      return false;
    }
    if (filter.plan?.kind === "none" && row.planKey !== null) {
      return false;
    }
    if (filter.plan?.kind === "key" && row.planKey !== filter.plan.key) {
      return false;
    }
    return true;
  });
}
