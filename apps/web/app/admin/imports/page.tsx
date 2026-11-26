import {
  callAction,
  DOMAIN_KEYS,
  selectDomains,
  TEMPLATES,
} from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getPool } from "../../../lib/auth";
import { drafterFor } from "../../../lib/drafter";
import {
  flowyteamReasonKey,
  isFlowyteamSuccess,
} from "../../../lib/flowyteam-messages";
import { pageTitle } from "../../../lib/page-title.ts";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { ArchiveImportCard } from "./archive-import-card.tsx";
import { FlowyteamCard } from "./flowyteam-card.tsx";
import { flowyteamCardView } from "./flowyteam-view.ts";
import { ImportWizard } from "./wizard.tsx";

export const generateMetadata = pageTitle("pageTitle.adminImports");

/**
 * The import card (UIUX-PLAN.md §6 S-36, P6-T01b-b).
 *
 * The wizard, and under it what this workspace has already imported. The list
 * is the reason `import_runs` records a dry run as well as a real one: a
 * previewed file that was never imported is a fact somebody will want a
 * quarter later, when they are asking why the numbers are short.
 *
 * Access is the layout's: `/admin` requires `full` and this page is under it,
 * so a member who may not import never reaches the wizard or the list.
 */
export default async function ImportsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getTranslations();
  const landed = (await searchParams).flowyteam;
  const outcomeWord = typeof landed === "string" ? landed : null;

  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const [runs, drafter, flowyteam] = await Promise.all([
    callAction(context, "imports.listRuns", { limit: 10 }),
    drafterFor(workspace.workspaceId, "balanced", session.user.id),
    callAction(context, "imports.flowyteamConnection", {}),
  ]);
  // The card's own runs, read further back than the ten listed below, so a
  // burst of spreadsheet previews cannot hide the step FlowyTeam is on.
  const flowyteamRuns = flowyteam.available
    ? (await callAction(context, "imports.listRuns", { limit: 50 })).runs
    : [];
  const people =
    flowyteam.connection !== null
      ? (await callAction(context, "imports.flowyteamPeople", {})).people
      : [];
  const view = flowyteamCardView(flowyteamRuns);
  const domains = DOMAIN_KEYS.map((key) => ({
    key,
    requires: [
      ...(selectDomains([key]).domains.find((domain) => domain.key === key)
        ?.requires ?? []),
    ],
  }));

  const entities = TEMPLATES.map((template) => ({
    entity: template.entity,
    describe: template.describe,
    fields: template.columns.map((column) => ({
      field: column.field,
      describe: column.describe,
      required: column.required,
    })),
  }));

  return (
    <>
      <header className="mb-4 flex flex-col gap-1">
        <h1 className="text-lg font-bold text-ink">
          {t("admin.imports.import")}
        </h1>
        <p className="max-w-prose text-sm text-ink-3">
          {t("admin.imports.intro")}
        </p>
      </header>
      <div className="flex flex-col gap-4">
        <FlowyteamCard
          available={flowyteam.available}
          backgroundWork={flowyteam.backgroundWork}
          connection={
            flowyteam.connection
              ? {
                  companyName: flowyteam.connection.companyName,
                  state: flowyteam.connection.state,
                  connectedAt: flowyteam.connection.connectedAt,
                }
              : null
          }
          view={view}
          people={people}
          domains={domains}
          outcome={
            outcomeWord
              ? {
                  ok: isFlowyteamSuccess(outcomeWord),
                  message: t(flowyteamReasonKey(outcomeWord)),
                }
              : null
          }
          failureMessage={
            view.failure ? t(flowyteamReasonKey(view.failure)) : null
          }
        />
        <ImportWizard entities={entities} aiOn={drafter !== null} />

        <Card>
          <CardHeader className="justify-between">
            <h2 className="text-sm font-bold text-ink">
              {t("common.recentRuns")}
            </h2>
            <span className="text-xs text-ink-3">
              {runs.runs.length === 0
                ? t("board.noneYet")
                : t("admin.imports.shown", { count: runs.runs.length })}
            </span>
          </CardHeader>
          <CardBody>
            {runs.runs.length === 0 ? (
              <p className="rounded-md border border-line border-dashed px-3 py-4 text-center text-sm text-ink-3">
                {t("admin.imports.nothingHasBeenImported")}
              </p>
            ) : (
              <ul
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
                tabIndex={0}
                aria-label={t("common.recentRuns")}
                className="relative max-h-[296px] divide-y divide-line overflow-y-auto pe-1.5 overscroll-contain rounded-lg border border-line"
                data-testid="import-runs"
              >
                {runs.runs.map((run) => (
                  <li
                    key={run.id}
                    className="flex items-center gap-3 px-3 py-2 text-sm"
                  >
                    <Chip tone={run.mode === "real" ? "info" : "neutral"}>
                      {run.mode === "real"
                        ? t("admin.imports.archiveImportCard.imported")
                        : t("admin.imports.preview")}
                    </Chip>
                    <Chip tone="neutral">
                      {run.source === "flowyteam"
                        ? t("admin.imports.flowyteam.sourceFlowyteam")
                        : t("admin.imports.flowyteam.sourceSpreadsheet")}
                    </Chip>
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {run.filename ?? run.source}
                      {run.entity ? ` · ${run.entity}` : ""}
                    </span>
                    <span className="text-xs text-ink-3">
                      {t(
                        run.mode === "real"
                          ? "admin.imports.writtenSkipped"
                          : "admin.imports.wouldWriteSkipped",
                        {
                          rowsWritten: run.rowsWritten,
                          rowsSkipped: run.rowsSkipped,
                        },
                      )}
                    </span>
                    <Chip
                      tone={
                        run.status === "completed"
                          ? "ok"
                          : run.status === "failed"
                            ? "bad"
                            : "warn"
                      }
                    >
                      {run.status}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        {/* Workspace archive import (P6-T05c). Taking an archive moved to
            Backups, one place to take a copy (backups-screen.md U2). */}
        <ArchiveImportCard />
      </div>
    </>
  );
}
