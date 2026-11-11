import { docsUrl } from "../../../lib/app-version";
import { getTranslations } from "../../../lib/translations";

/**
 * Two things an instance used to get wrong in silence (completeness review
 * H-01, H-02).
 *
 * The Compose install connected as a Postgres superuser, which row-level
 * security never binds, and a scheduler that could not start logged one line
 * while the product carried on looking healthy. Both were invisible from the
 * browser. They are shown here, on the instance settings screen, beside the
 * console-mail notice and in the same shape, for the same reason that notice
 * gives: there is no instance-health screen, so this is where an
 * instance-level warning belongs until one exists.
 *
 * **The third is a process that cannot place its callers** (plan 0.8.0 H2,
 * docs/design/trusted-proxies.md D12). Behind a CDN and a load balancer every
 * visitor resolves to one shared count, and nothing on screen said so. A
 * correct deployment never meets an unplaced caller, and the fix is a restart
 * with a variable set, which also clears what this process has seen. Never on
 * a managed cloud: the network in front is the operator's, who reads
 * `openokr_caller_addresses_total` and the log, not a customer's
 * administrator.
 *
 * **The scheduler notice has two forms** (plan 0.8.0 H10d,
 * docs/design/worker-deployment.md §1.3). `failed` is this process's
 * scheduler that could not start. `elsewhere` is a process whose scheduler
 * runs on the worker, when no scheduler has completed a run for longer than
 * `/api/status` allows: the fix is on the worker, so the notice says so.
 */
export async function InstanceHealthNotice({
  tenantFloorBypassed,
  scheduler,
  unplacedCallers,
  cloud,
}: {
  tenantFloorBypassed: boolean;
  scheduler: "failed" | "elsewhere" | null;
  unplacedCallers: boolean;
  cloud: boolean;
}) {
  const callerAddress = unplacedCallers && !cloud;
  if (!tenantFloorBypassed && scheduler === null && !callerAddress) {
    return null;
  }
  const { t } = await getTranslations();

  return (
    <>
      {tenantFloorBypassed ? (
        <section
          className="rounded-md border border-warn/30 bg-warn-bg p-4.5"
          data-testid="tenant-floor-notice"
        >
          <h2 className="text-sm font-bold text-ink">
            {t("admin.general.tenantFloor.title")}
          </h2>
          <p className="mt-1.5 text-sm text-ink-2">
            {t("admin.general.tenantFloor.what")}
          </p>
          <p className="mt-1.5 text-sm text-ink-2">
            {t("admin.general.tenantFloor.fix")}
          </p>
        </section>
      ) : null}
      {scheduler !== null ? (
        <section
          className="rounded-md border border-warn/30 bg-warn-bg p-4.5"
          data-testid="scheduler-notice"
        >
          <h2 className="text-sm font-bold text-ink">
            {t("admin.general.scheduler.title")}
          </h2>
          <p className="mt-1.5 text-sm text-ink-2">
            {scheduler === "elsewhere"
              ? t("admin.general.scheduler.elsewhereWhat")
              : t("admin.general.scheduler.what")}
          </p>
          <p className="mt-1.5 text-sm text-ink-2">
            {scheduler === "elsewhere"
              ? t("admin.general.scheduler.elsewhereFix")
              : t("admin.general.scheduler.fix")}
          </p>
        </section>
      ) : null}
      {callerAddress ? (
        <section
          className="rounded-md border border-warn/30 bg-warn-bg p-4.5"
          data-testid="caller-address-notice"
        >
          <h2 className="text-sm font-bold text-ink">
            {t("admin.general.callerAddress.title")}
          </h2>
          <p className="mt-1.5 text-sm text-ink-2">
            {t("admin.general.callerAddress.what")}
          </p>
          <p className="mt-1.5 text-sm text-ink-2">
            {t("admin.general.callerAddress.fix")}
          </p>
          <p className="mt-1.5 text-sm">
            <a
              className="font-medium text-brand-text hover:underline"
              href={docsUrl("docs/install/behind-a-proxy.md")}
              rel="noreferrer"
              target="_blank"
            >
              {t("admin.general.callerAddress.guide")}
            </a>
          </p>
        </section>
      ) : null}
    </>
  );
}
