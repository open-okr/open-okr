import { listTenantsAsOperator, readUsageAsOperator } from "@openokr/core";
import { Chip, type ChipProps } from "@openokr/ui";
import Link from "next/link";
import { requireOperator } from "../../lib/operator";
import { getPool } from "../../lib/pool";
import { getTranslations } from "../../lib/translations";

/**
 * S-45 Operator workspaces: the list, and the only screen that shows more
 * than one tenant at a time (P8-T03b).
 *
 * **Everything on it is metadata.** A name and a slug cross, because they are
 * how a support request is matched to a customer and the customer chose them
 * as an identifier. The counts come from the snapshot table, refreshed by
 * `pnpm cloud:usage` and carrying the instant it was taken. No title, no
 * objective, nothing a member wrote.
 *
 * The guard is `requireOperator`, which answers not-found on a self-hosted
 * instance and to anybody without a live grant. The database policies
 * underneath answer the same way, so a bug in this file cannot widen what a
 * request returns.
 *
 * **It borrows the product's own vocabulary rather than inventing a second
 * one.** `Chip` is the tone primitive every state badge in the product
 * already renders through, and the colour tokens are the declared ones. An
 * operator screen that looked like a different product would be a second
 * design system to maintain for four pages.
 */
export const dynamic = "force-dynamic";

const STATE_TONE: Record<string, ChipProps["tone"]> = {
  active: "ok",
  suspended: "warn",
  closed: "neutral",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default async function OperatorWorkspacesPage() {
  const operator = await requireOperator();
  const pool = getPool();

  const [tenants, usage] = await Promise.all([
    listTenantsAsOperator(pool, operator.userId),
    readUsageAsOperator(pool, operator.userId),
  ]);
  const byWorkspace = new Map(usage.map((row) => [row.workspaceId, row]));
  const { t } = await getTranslations();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-ink text-lg">
          {t("operator.workspaces.title")}
        </h1>
        <p className="text-ink-2 text-sm">
          {tenants.length === 1
            ? "1 tenant on this instance."
            : `${tenants.length} tenants on this instance.`}{" "}
          {t("operator.workspaces.countsAreStale")}
        </p>
      </header>

      {tenants.length === 0 ? (
        // An empty state that is a statement rather than an error. A fresh
        // cloud instance has no tenants, and that is not a problem.
        <p className="rounded-lg border border-line bg-surface p-6 text-ink-2 text-sm">
          {t("operator.workspaces.none")}
        </p>
      ) : (
        /* The one place this screen may scroll sideways. Everything else
         * wraps, because a page that scrolls horizontally is a page somebody
         * reads half of. */
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-line border-b text-left">
                <th className="p-3 font-medium text-ink-2">
                  {t("operator.workspaces.columnWorkspace")}
                </th>
                <th className="p-3 font-medium text-ink-2">
                  {t("operator.workspaces.columnState")}
                </th>
                <th className="p-3 font-medium text-ink-2">
                  {t("operator.workspaces.columnPlan")}
                </th>
                <th className="p-3 text-right font-medium text-ink-2">
                  {t("operator.workspaces.columnMembers")}
                </th>
                <th className="p-3 text-right font-medium text-ink-2">
                  {t("operator.workspaces.columnGoals")}
                </th>
                <th className="p-3 text-right font-medium text-ink-2">
                  {t("operator.workspaces.columnStorage")}
                </th>
                <th className="p-3 font-medium text-ink-2">
                  {t("operator.workspaces.columnRegion")}
                </th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
                const rows = byWorkspace.get(tenant.workspaceId);
                return (
                  <tr
                    key={tenant.workspaceId}
                    className="border-line border-b last:border-b-0"
                  >
                    <td className="p-3">
                      <Link
                        className="font-medium text-brand-text hover:underline"
                        href={`/operator/${tenant.workspaceId}`}
                      >
                        {tenant.name}
                      </Link>
                      <span className="block text-ink-3 text-xs">
                        {tenant.slug}
                      </span>
                    </td>
                    <td className="p-3">
                      {/* Tone is never the only signal: the word is there
                       * too, which is the §2 rule the Chip primitive's own
                       * comment states. */}
                      <Chip tone={STATE_TONE[tenant.tenantState] ?? "neutral"}>
                        {tenant.tenantState}
                      </Chip>
                    </td>
                    <td className="p-3 text-ink-2">
                      {tenant.planKey ?? "free"}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {rows ? rows.memberCount : "not measured"}
                      {tenant.seats === null ? "" : ` / ${tenant.seats}`}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {rows ? rows.goalCount : "not measured"}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {rows ? formatBytes(rows.storageBytes) : "not measured"}
                    </td>
                    <td className="p-3 text-ink-2">{tenant.region}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* "Not measured" and zero are different facts, and a dash would have
       * let somebody read the first as the second. Said out loud here, with
       * the command that fixes it. */}
      {usage.length < tenants.length ? (
        <p className="text-ink-2 text-sm">
          {t("operator.workspaces.neverMeasured")}
        </p>
      ) : null}
    </div>
  );
}
