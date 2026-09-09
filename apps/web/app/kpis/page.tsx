import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../lib/access";
import { getPool } from "../../lib/auth";
import { KPI_TABS, SectionTabs } from "../../lib/section-tabs.tsx";
import { requireWorkspace } from "../../lib/workspace";
import { ActionForm } from "../cycle/action-form.tsx";
import { addCategory, addKpi } from "./actions.ts";
import { KpiGrid } from "./grid.tsx";
import { CategorySubtotal, FilterRow, RowSparkline } from "./grid-extras.tsx";

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
export default async function KpisPage({
  searchParams,
}: {
  /**
   * The filters, in the url (P6-G30).
   *
   * **The explorer's own pattern**: a combination survives a reload and can be
   * sent to somebody, which local state loses on both counts.
   */
  searchParams: Promise<{
    frequency?: string;
    owner?: string;
    category?: string;
    state?: string;
  }>;
}) {
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

  // **Filtered here rather than in the read.** The grid is one page of every
  // KPI a workspace has, the read already returns them all, and a filter that
  // went to the database would make the category subtotals answer for the
  // filtered set while the categories themselves came from the whole one.
  const filters = await searchParams;
  const query: Record<string, string> = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
  const shown = grid.kpis.filter(
    (kpi) =>
      (!filters.frequency || kpi.frequency === filters.frequency) &&
      (!filters.owner || kpi.ownerId === filters.owner) &&
      (!filters.category || (kpi.categoryId ?? "") === filters.category) &&
      (!filters.state || kpi.state === filters.state),
  );

  const frequencies = [
    ...new Set(grid.kpis.map((kpi) => kpi.frequency)),
  ].sort();
  const states = [...new Set(grid.kpis.map((kpi) => kpi.state))].sort();
  const owners = [
    ...new Map(
      grid.kpis
        .filter((kpi) => kpi.ownerId !== null && kpi.ownerName !== null)
        .map((kpi) => [kpi.ownerId as string, kpi.ownerName as string]),
    ).entries(),
  ].sort((left, right) => left[1].localeCompare(right[1]));
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
        <CardBody className="flex flex-col gap-2.5">
          {/* S-20's filter row, at last (P6-G30). */}
          <FilterRow
            label="Frequency"
            param="frequency"
            active={filters.frequency ?? ""}
            query={query}
            choices={frequencies.map((one) => ({ value: one, label: one }))}
          />
          <FilterRow
            label="State"
            param="state"
            active={filters.state ?? ""}
            query={query}
            choices={states.map((one) => ({
              value: one,
              label: one.replace("_", " "),
            }))}
          />
          {owners.length > 0 ? (
            <FilterRow
              label="Owner"
              param="owner"
              active={filters.owner ?? ""}
              query={query}
              choices={owners.map(([id, name]) => ({ value: id, label: name }))}
            />
          ) : null}
          {grid.categories.length > 0 ? (
            <FilterRow
              label="Category"
              param="category"
              active={filters.category ?? ""}
              query={query}
              choices={grid.categories.map((one) => ({
                value: one.id ?? "",
                label: one.name,
              }))}
            />
          ) : null}
        </CardBody>
        <CardBody className="p-0">
          <KpiGrid
            categories={grid.categories}
            kpis={shown}
            canEdit={canEdit}
            today={today}
          />
        </CardBody>
      </Card>

      {/*
       * What each category adds up to, and what each row has been doing
       * (P6-G30). Beside the grid rather than inside it: the grid is a
       * scrolling table of periods and these are answers about the rows.
       */}
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">By category</h2>
            <p className="text-xs text-ink-3">
              A tally of §6.4&apos;s corridor states, not a sum of values:
              adding a revenue figure to a response time would be a number
              nobody measured.
            </p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {/*
           * `kpis.grid` already returns an entry with a null id for the
           * uncategorised ones, so adding a second here drew the section
           * twice. Caught by an end-to-end snapshot rather than by reading
           * the read's own contract, which is the cheaper way round.
           */}
          {grid.categories.map((category) => {
            const inCategory = shown.filter(
              (kpi) => (kpi.categoryId ?? null) === category.id,
            );
            if (inCategory.length === 0) {
              return null;
            }
            return (
              <div
                key={category.id ?? "none"}
                className="flex flex-col gap-1.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">
                    {category.name}
                  </span>
                  <CategorySubtotal
                    states={inCategory.map((kpi) => kpi.state)}
                  />
                </div>
                <ul className="flex flex-col gap-1">
                  {inCategory.map((kpi) => (
                    <li
                      key={kpi.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="text-xs text-ink-2">{kpi.title}</span>
                        {kpi.isCalculated ? (
                          <Chip tone="info">{kpi.formula ?? "calculated"}</Chip>
                        ) : null}
                      </span>
                      <RowSparkline records={kpi.records} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
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
                  <label className="text-xs text-ink-3" htmlFor="targetDefault">
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
                <Button type="submit" variant="primary" className="self-start">
                  Add
                </Button>
                <p className="text-xs text-ink-4">
                  The corridor defaults to the §11 registry, 90 and 70. A
                  calculated KPI is added from its own detail screen, where the
                  formula builder is: this form has no way to ask for a formula,
                  and one that read no_data forever would be worse than none.
                </p>
              </ActionForm>
            </CardBody>
          </Card>

          <Card className="w-full lg:w-72">
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">Add a category</h2>
            </CardHeader>
            <CardBody>
              <ActionForm action={addCategory} className="flex flex-col gap-2">
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
                  Categories are how the grid groups its rows. A KPI without one
                  still has a group.
                </p>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
