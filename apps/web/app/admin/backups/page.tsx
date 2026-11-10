import { callAction, isCloudEnabled, resolveSupportEmail } from "@openokr/core";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import { docsUrl } from "../../../lib/app-version";
import { getPool } from "../../../lib/auth";
import { dayLabel } from "../../../lib/day-label.ts";
import { pageTitle } from "../../../lib/page-title.ts";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { ExportCard } from "./export-card.tsx";

export const generateMetadata = pageTitle("pageTitle.adminBackups");

/**
 * Backups in workspace admin (UIUX-PLAN S-36, docs/design/backups-screen.md,
 * plan 0.7.0 U3).
 *
 * Four cards. The workspace's own backup is its archive, so the first takes
 * one and the second lists every one taken. The third says how a copy is
 * restored, in words, because importing an archive into the workspace it came
 * from would add a second copy of everything. The fourth says where the
 * instance's own backups come from and claims nothing about them: the
 * application never sees one, and one holds every workspace, so it is never a
 * workspace's to touch.
 *
 * `full`, through the layout and the section's own level. It works in a
 * suspended or closed workspace, when the archive matters most.
 */
export default async function BackupsPage() {
  const { t, locale } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const pool = getPool();
  const context = {
    pool,
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const [history, cloud, supportEmail] = await Promise.all([
    callAction(context, "workspace.listArchives", {}),
    isCloudEnabled(pool),
    resolveSupportEmail(pool),
  ]);

  return (
    <>
      <h1 className="mb-4 text-lg font-bold text-ink">
        {t("admin.backups.title")}
      </h1>
      <div className="flex flex-col gap-4">
        <ExportCard />

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("admin.backups.historyTitle")}
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            <p className="text-xs text-ink-3">
              {t("admin.backups.historyNote")}
            </p>
            {history.archives.length === 0 ? (
              <p className="rounded-md border border-line border-dashed px-3 py-4 text-center text-sm text-ink-3">
                {t("admin.backups.noneTaken")}
              </p>
            ) : (
              <ul
                className="flex flex-col divide-y divide-line"
                data-testid="archive-history"
              >
                {history.archives.map((archive) => (
                  <li
                    key={archive.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm"
                  >
                    <span className="font-medium text-ink">
                      {archive.takenByName ?? t("admin.backups.someone")}
                    </span>
                    <span className="text-ink-2">
                      {dayLabel(archive.takenAt, locale)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink-3">
                      {archive.filename}
                    </span>
                    {archive.rows === null ? null : (
                      <span className="text-xs text-ink-3">
                        {t("admin.backups.rows", { count: archive.rows })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("admin.backups.restoreTitle")}
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-1.5 text-sm text-ink-2">
            <p>{t("admin.backups.restoreBody")}</p>
            <p>
              <a
                className="font-medium text-brand-text hover:underline"
                href={docsUrl("docs/runbooks/migration-cutover.md")}
                rel="noreferrer"
                target="_blank"
              >
                {t("admin.backups.restoreGuide")}
              </a>
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("admin.backups.instanceTitle")}
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-1.5 text-sm text-ink-2">
            {cloud ? (
              <>
                <p>{t("admin.backups.instanceCloud")}</p>
                {supportEmail ? (
                  <p>
                    <a
                      className="font-medium text-brand-text hover:underline"
                      href={`mailto:${supportEmail}`}
                    >
                      {supportEmail}
                    </a>
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p>{t("admin.backups.instanceSelfHosted")}</p>
                <p>
                  <a
                    className="font-medium text-brand-text hover:underline"
                    href={docsUrl("docs/runbooks/restore.md")}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {t("admin.backups.instanceGuide")}
                  </a>
                </p>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
