import { Card, CardBody, CardHeader } from "@openokr/ui";
import { upgradeNotesUrl } from "../../../lib/app-version.ts";
import type { ReleaseCheck } from "../../../lib/newest-release.ts";
import { getTranslations } from "../../../lib/translations";

/**
 * Which release this deployment runs, and whether a newer one exists
 * (docs/design/version-footer.md §9, plan 0.8.0 V2).
 *
 * On a managed cloud the footer never tells a customer a newer release
 * exists, because the customer cannot upgrade. Until 0.8.0 nobody was told,
 * the operator included, and the console showed no version at all. The notice
 * is here because the operator is the one who upgrades.
 *
 * The upgrade notes are the runbook as the newer release shipped it, because
 * that is the procedure for reaching it.
 */
export async function OperatorVersionCard({
  running,
  check,
}: {
  readonly running: string;
  readonly check: ReleaseCheck;
}) {
  const { t } = await getTranslations();
  const { newer } = check;

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-bold text-ink">
            {t("operator.instance.version.title")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("operator.instance.version.lead")}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-2.5 text-sm">
        <p
          className="tabular-nums text-ink"
          data-testid="operator-version-running"
        >
          {t("operator.instance.version.running", { version: running })}
        </p>
        {newer ? (
          <div
            className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5"
            data-testid="operator-version-newer"
          >
            <a
              href={newer.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-6 items-center gap-1.5 rounded-full bg-brand-weak px-2.5 text-xs font-semibold text-brand-text hover:underline"
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-brand"
              />
              {t("shell.version.available", { version: newer.version })}
            </a>
            <a
              href={upgradeNotesUrl(newer.version)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink"
            >
              {t("operator.instance.version.upgradeNotes")}
            </a>
          </div>
        ) : (
          <p
            className="text-xs text-ink-3"
            data-testid={
              check.enabled
                ? "operator-version-current"
                : "operator-version-off"
            }
          >
            {check.enabled
              ? t("operator.instance.version.upToDate")
              : t("operator.instance.version.checkOff")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
