import { callAction } from "@openokr/core";

/** A KPI a key result can read its value from (completeness review M-07). */
export interface KpiOption {
  readonly id: string;
  readonly title: string;
  readonly unit: string | null;
}

/**
 * The KPIs a key result can read from, for the two places that offer the
 * choice: drafting on the cycle's phase 4 (S-09) and the goal page (S-14).
 *
 * Read through `kpis.list`, so a member sees exactly the KPIs the grid would
 * show them and nothing a picker assembled on its own.
 *
 * **Null when the list could not be read.** Each picker is one control on a
 * larger screen, so a failed read turns that control into "measured by hand"
 * and says so, rather than taking the drafting step or the goal page down.
 */
export async function readKpiOptions(
  context: Parameters<typeof callAction>[0],
): Promise<readonly KpiOption[] | null> {
  try {
    const { kpis } = await callAction(context, "kpis.list", {});
    return kpis.map((kpi) => ({
      id: kpi.id,
      title: kpi.title,
      unit: kpi.unit,
    }));
  } catch {
    // The rest of either screen is the work itself, so it has to render when
    // this one list cannot be read.
    return null;
  }
}
