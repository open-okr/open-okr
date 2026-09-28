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
 */
export async function InstanceHealthNotice({
  tenantFloorBypassed,
  schedulerFailed,
}: {
  tenantFloorBypassed: boolean;
  schedulerFailed: boolean;
}) {
  if (!tenantFloorBypassed && !schedulerFailed) {
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
      {schedulerFailed ? (
        <section
          className="rounded-md border border-warn/30 bg-warn-bg p-4.5"
          data-testid="scheduler-notice"
        >
          <h2 className="text-sm font-bold text-ink">
            {t("admin.general.scheduler.title")}
          </h2>
          <p className="mt-1.5 text-sm text-ink-2">
            {t("admin.general.scheduler.what")}
          </p>
          <p className="mt-1.5 text-sm text-ink-2">
            {t("admin.general.scheduler.fix")}
          </p>
        </section>
      ) : null}
    </>
  );
}
