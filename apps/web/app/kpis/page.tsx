import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Button, Card, CardBody, CardHeader } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../lib/access";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { KPI_TABS, SectionTabs } from "../../lib/section-tabs.tsx";
import { requireWorkspace } from "../../lib/workspace";
import { ActionForm } from "../cycle/action-form.tsx";
import { addCategory, addKpi } from "./actions.ts";
import { KpiGrid } from "./grid.tsx";

/**
 * The KPI grid (UIUX-PLAN.md §4 S-20, P3-T12).
 *
 * The data is server-rendered and the entry is client-owned, which is the split
 * §13.3 asks for: a grid is an interactive surface, and the periods behind it are
 * a read.
 *
 * Three of S-20's features are not here and each says why below rather than being
 * quietly absent: sparklines in the row header, the filters, and the calculated
 * cell's formula chip.
 */
export default async function KpisPage() {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;

  const grid = await callAction(context, "kpis.grid", { periods: 12 });
  // Today in the workspace calendar, resolved on the server. The grid needs it to
  // draw a column for the current period, and the browser clock is the wrong one.
  const settings = await callAction(
    context,
    "settings.readWorkspaceSettings",
    {},
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: String(settings.settings.timezone ?? "UTC"),
  }).format(new Date());

  return (
    <AppShellLayout>
      <div className="flex w-full flex-col gap-3.5">
        <SectionTabs items={KPI_TABS} active="/kpis" />
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">KPIs</h1>
              <p className="text-xs text-ink-3">
                {grid.kpis.length === 0
                  ? "Nothing measured yet."
                  : `${grid.kpis.length} measure${
                      grid.kpis.length === 1 ? "" : "s"
                    }, each in its own periods.`}
              </p>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <KpiGrid
              categories={grid.categories}
              kpis={grid.kpis}
              canEdit={canEdit}
              today={today}
            />
          </CardBody>
        </Card>

        {canEdit ? (
          <div className="flex flex-col gap-3.5 lg:flex-row lg:items-start">
            <Card className="flex-1">
              <CardHeader>
                <h2 className="text-sm font-bold text-ink">Add a KPI</h2>
              </CardHeader>
              <CardBody>
                <ActionForm action={addKpi} className="flex flex-col gap-2">
                  <label
                    className="text-xs font-semibold text-ink-2"
                    htmlFor="title"
                  >
                    What is being measured
                  </label>
                  <input
                    id="title"
                    name="title"
                    required
                    placeholder="Mobile activation rate"
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-4"
                  />
                  <div className="flex flex-wrap items-center gap-2.5">
                    <label className="text-xs text-ink-3" htmlFor="frequency">
                      Frequency
                    </label>
                    <select
                      id="frequency"
                      name="frequency"
                      defaultValue="monthly"
                      className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
                    >
                      <option value="daily">daily</option>
                      <option value="weekly">weekly</option>
                      <option value="monthly">monthly</option>
                      <option value="quarterly">quarterly</option>
                      <option value="yearly">yearly</option>
                    </select>
                    <label className="text-xs text-ink-3" htmlFor="direction">
                      Better when
                    </label>
                    <select
                      id="direction"
                      name="direction"
                      defaultValue="higher_better"
                      className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
                    >
                      <option value="higher_better">higher</option>
                      <option value="lower_better">lower</option>
                    </select>
                    <label
                      className="text-xs text-ink-3"
                      htmlFor="targetDefault"
                    >
                      Standing target
                    </label>
                    <input
                      id="targetDefault"
                      name="targetDefault"
                      type="number"
                      step="any"
                      className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    className="self-start"
                  >
                    Add
                  </Button>
                  <p className="text-xs text-ink-4">
                    The corridor defaults to the §11 registry, 90 and 70. A
                    calculated KPI is added from its own detail screen, where
                    the formula builder is: this form has no way to ask for a
                    formula, and one that read no_data forever would be worse
                    than none.
                  </p>
                </ActionForm>
              </CardBody>
            </Card>

            <Card className="w-full lg:w-72">
              <CardHeader>
                <h2 className="text-sm font-bold text-ink">Add a category</h2>
              </CardHeader>
              <CardBody>
                <ActionForm
                  action={addCategory}
                  className="flex flex-col gap-2"
                >
                  <label className="sr-only" htmlFor="name">
                    Category name
                  </label>
                  <input
                    id="name"
                    name="name"
                    required
                    placeholder="Revenue"
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-4"
                  />
                  <Button type="submit" className="self-start">
                    Add
                  </Button>
                  <p className="text-xs text-ink-4">
                    Categories are how the grid groups its rows. A KPI without
                    one still has a group.
                  </p>
                </ActionForm>
              </CardBody>
            </Card>
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">Not here yet</h2>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-1 text-xs text-ink-3">
              <li>
                Row sparklines and category subtotals, at P6-G30. The aggregate
                rules in §6 of the KPI design they need are already in
                <code>packages/method</code>.
              </li>
              <li>
                Filters by frequency, owner, category and state, at P6-G30. The
                grid is one URL today; the filters follow the explorer's pattern
                and are worth doing once, beside it.
              </li>
              <li>
                The formula chip on a calculated cell. Calculated KPIs are
                read-only here already, and the chip needs a formula to name.
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
