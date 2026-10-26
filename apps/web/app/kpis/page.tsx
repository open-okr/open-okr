import { ACCESS_LEVELS, callAction, RHYTHM_ASSIST_KEYS } from "@openokr/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  EntityPicker,
  NumberInput,
  SelectInput,
  TextInput,
  UnitInput,
} from "@openokr/ui";
import { workspaceReaderLevel } from "../../lib/access";
import { assistOffered } from "../../lib/assists";
import { getPool } from "../../lib/auth";
import { memberOption } from "../../lib/entity-options.ts";
import { searchHumans } from "../../lib/member-search.ts";
import { KPI_TABS, SectionTabs } from "../../lib/section-tabs.tsx";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { ActionForm } from "../cycle/action-form.tsx";
import { addCategory, addKpi } from "./actions.ts";
import { KpiGrid } from "./grid.tsx";
import { CategorySubtotal, FilterRow, RowSparkline } from "./grid-extras.tsx";
import { JudgedBy } from "./judged-by.tsx";
import { KpiSuggestion } from "./kpi-suggestion.tsx";

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
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const level = await workspaceReaderLevel(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;
  // §2.2's suggestion beside the add form (M-09), for somebody who may add a
  // KPI and only where a provider may write one. The form is the same either
  // way.
  const suggestionOffered =
    canEdit &&
    (await assistOffered(
      workspace.workspaceId,
      RHYTHM_ASSIST_KEYS.suggestKpi,
      "balanced",
      session.user.id,
    ));

  const grid = await callAction(context, "kpis.grid", { periods: 12 });
  // Who may own a KPI: a person who is here (§6.2, P9-T17b-b). Read only for
  // somebody who may add one.
  const people = canEdit
    ? (await callAction(context, "people.directory", {})).filter(
        (member) => member.kind === "human" && member.status === "active",
      )
    : [];

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
  const settings = await callAction(context, "settings.readForMember", {});
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: String(settings.settings.timezone ?? "UTC"),
  }).format(new Date());

  return (
    <div className="flex w-full flex-col gap-3.5">
      <SectionTabs items={KPI_TABS} active="/kpis" />
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-bold text-ink">{t("common.count")}</h1>
            <p className="text-xs text-ink-3">
              {grid.kpis.length === 0
                ? t("kpis.nothingMeasuredYet")
                : grid.kpis.length === 1
                  ? t("kpis.measuresOne", { count: grid.kpis.length })
                  : t("kpis.measuresOther", { count: grid.kpis.length })}
            </p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-2.5">
          {/* S-20's filter row, at last (P6-G30). */}
          <FilterRow
            label={t("common.frequency")}
            param="frequency"
            active={filters.frequency ?? ""}
            query={query}
            choices={frequencies.map((one) => ({ value: one, label: one }))}
          />
          <FilterRow
            label={t("operator.workspaces.columnState")}
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
              label={t("common.owner")}
              param="owner"
              active={filters.owner ?? ""}
              query={query}
              choices={owners.map(([id, name]) => ({ value: id, label: name }))}
            />
          ) : null}
          {grid.categories.length > 0 ? (
            <FilterRow
              label={t("kpis.category")}
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
            <h2 className="text-sm font-bold text-ink">
              {t("kpis.byCategory")}
            </h2>
            <p className="text-xs text-ink-3">{t("kpis.aTallyOf")}</p>
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
                    recovering={
                      inCategory.filter((kpi) => kpi.recovering).length
                    }
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
                          <Chip tone="info">
                            {kpi.formula ?? t("kpis.grid.calculated")}
                          </Chip>
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
              <h2 className="text-sm font-bold text-ink">
                {t("kpis.addAKpi")}
              </h2>
            </CardHeader>
            <CardBody>
              <ActionForm action={addKpi} className="flex flex-col gap-2">
                <TextInput
                  id="title"
                  label={t("kpis.whatIsBeingMeasured")}
                  name="title"
                  required
                  maxLength={500}
                  placeholder={t("kpis.mobileActivationRate")}
                  inputClassName="placeholder:text-ink-4"
                />
                <div className="flex flex-wrap items-center gap-2.5">
                  <SelectInput
                    id="frequency"
                    label={t("common.frequency")}
                    name="frequency"
                    defaultValue="monthly"
                    className="flex-row items-center gap-2.5"
                    inputClassName="h-6.5 w-auto text-xs text-ink-2"
                  >
                    <option value="daily">{t("common.daily")}</option>
                    <option value="weekly">{t("common.weekly")}</option>
                    <option value="monthly">{t("common.monthly")}</option>
                    <option value="quarterly">{t("common.quarterly")}</option>
                    <option value="yearly">{t("common.yearly")}</option>
                  </SelectInput>
                </div>
                {/* guided-inputs §4.8: the target as a number, and the unit
                    it is measured in, which the form did not ask for. */}
                <div className="flex flex-wrap items-end gap-2.5">
                  <NumberInput
                    id="targetDefault"
                    label={t("common.standingTarget")}
                    name="targetDefault"
                    inputClassName="h-auto w-24 py-1 text-xs"
                  />
                  <UnitInput
                    id="kpi-unit"
                    label={t("kpis.unit")}
                    name="unit"
                    known={grid.kpis.flatMap((kpi) =>
                      kpi.unit ? [kpi.unit] : [],
                    )}
                    inputClassName="h-auto w-28 py-1 text-xs"
                  />
                </div>
                <JudgedBy idPrefix="add" />
                <div className="flex flex-wrap items-center gap-2.5">
                  <EntityPicker
                    id="ownerMemberId"
                    label={t("kpis.rule.owner")}
                    name="ownerMemberId"
                    required
                    defaultValue={workspace.memberId}
                    options={people.map((person) =>
                      memberOption(person, t("common.agent")),
                    )}
                    search={searchHumans}
                    className="w-56"
                    inputClassName="text-xs"
                  />
                  <SelectInput
                    id="tier"
                    label={t("kpis.rule.tier")}
                    name="tier"
                    defaultValue=""
                    className="flex-row items-center gap-2.5"
                    inputClassName="h-6.5 w-auto text-xs text-ink-2"
                  >
                    <option value="">{t("kpis.rule.noTier")}</option>
                    <option value="input">{t("kpis.rule.tierInput")}</option>
                    <option value="output">{t("kpis.rule.tierOutput")}</option>
                    <option value="outcome">
                      {t("kpis.rule.tierOutcome")}
                    </option>
                    <option value="impact">{t("kpis.rule.tierImpact")}</option>
                  </SelectInput>
                </div>
                <Button type="submit" variant="primary" className="self-start">
                  {t("common.add")}
                </Button>
                <p className="text-xs text-ink-4">
                  {t("kpis.theCorridorDefaultsTo")}
                </p>
              </ActionForm>
              {suggestionOffered ? <KpiSuggestion /> : null}
            </CardBody>
          </Card>

          <Card className="w-full lg:w-72">
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                {t("kpis.addACategory")}
              </h2>
            </CardHeader>
            <CardBody>
              <ActionForm action={addCategory} className="flex flex-col gap-2">
                <TextInput
                  id="name"
                  label={t("kpis.categoryName")}
                  hideLabel
                  name="name"
                  required
                  maxLength={120}
                  placeholder={t("kpis.revenue")}
                  inputClassName="placeholder:text-ink-4"
                />
                <Button type="submit" className="self-start">
                  {t("common.add")}
                </Button>
                <p className="text-xs text-ink-4">
                  {t("kpis.categoriesAreHowThe")}
                </p>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
