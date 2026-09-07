import { callAction, TEMPLATES } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getPool } from "../../../lib/auth";
import { drafterFor } from "../../../lib/drafter";
import { requireWorkspace } from "../../../lib/workspace";
import { ImportWizard } from "./wizard.tsx";

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
export default async function ImportsPage() {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const [runs, drafter] = await Promise.all([
    callAction(context, "imports.listRuns", { limit: 10 }),
    drafterFor(workspace.workspaceId),
  ]);

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
      <h1 className="mb-4 text-lg font-bold text-ink">Import</h1>
      <div className="flex flex-col gap-4">
        <ImportWizard entities={entities} aiOn={drafter !== null} />

        <Card>
          <CardHeader className="justify-between">
            <h2 className="text-sm font-bold text-ink">Recent runs</h2>
            <span className="text-xs text-ink-3">
              {runs.runs.length === 0
                ? "None yet"
                : `${runs.runs.length} shown`}
            </span>
          </CardHeader>
          <CardBody>
            {runs.runs.length === 0 ? (
              <p className="rounded-md border border-line border-dashed px-3 py-4 text-center text-sm text-ink-3">
                Nothing has been imported into this workspace. A preview counts
                as a run and appears here too.
              </p>
            ) : (
              <ul
                className="flex flex-col divide-y divide-line"
                data-testid="import-runs"
              >
                {runs.runs.map((run) => (
                  <li
                    key={run.id}
                    className="flex items-center gap-3 py-2 text-sm"
                  >
                    <Chip tone={run.mode === "real" ? "info" : "neutral"}>
                      {run.mode === "real" ? "Imported" : "Preview"}
                    </Chip>
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {run.filename ?? run.source}
                      {run.entity ? ` · ${run.entity}` : ""}
                    </span>
                    <span className="text-xs text-ink-3">
                      {run.rowsWritten} written, {run.rowsSkipped} skipped
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
      </div>
    </>
  );
}
