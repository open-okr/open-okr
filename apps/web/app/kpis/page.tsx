import { ACCESS_LEVELS, callAction, RHYTHM_ASSIST_KEYS } from "@openokr/core";
import {
  buttonVariants,
  EntityPicker,
  Kbd,
  NumberInput,
  SelectInput,
  TextInput,
  UnitInput,
} from "@openokr/ui";
import type { ReactNode } from "react";
import { workspaceReaderLevel } from "../../lib/access";
import { AreaTabs } from "../../lib/area-tabs.tsx";
import { assistOffered } from "../../lib/assists";
import { getPool } from "../../lib/auth";
import { memberOption } from "../../lib/entity-options.ts";
import { searchHumans } from "../../lib/member-search.ts";
import { pageTitle } from "../../lib/page-title.ts";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { GoalsToolbar } from "../goals/goals-toolbar.tsx";
import { addCategory, addKpi } from "./actions.ts";
import { KpiGrid } from "./grid.tsx";
import { CategorySubtotal } from "./grid-extras.tsx";
import { JudgedBy } from "./judged-by.tsx";
import { kpiCount } from "./kpi-count.ts";
import { KpiPanel } from "./kpi-panel.tsx";
import { KpiSuggestion } from "./kpi-suggestion.tsx";
import { KpiTabs } from "./kpi-tabs.tsx";

export const generateMetadata = pageTitle("pageTitle.kpis");

/**
 * The KPI grid (UIUX-PLAN.md §4 S-20, P3-T12, redesigned 2 November 2026).
 *
 * The data is server-rendered and the entry is client-owned, which is the split
 * §13.3 asks for: a grid is an interactive surface, and the periods behind it are
 * a read.
 *
 * The layout follows the Goals list: one card holding the title, the tally and
 * the two buttons, then the tabs with the Filter button; the grid under it.
 * New KPI and New category open from their buttons (`?new=kpi`,
 * `?new=category`) instead of standing open under the grid. **The forms ask
 * for exactly what they asked for before**, every field with every option,
 * plus the category, which the read already had and the form never asked.
 */

/** The category filter's value for the KPIs that have no category. */
const UNCATEGORISED = "none";

const FILTER_KEYS = ["frequency", "state", "owner", "category"] as const;

export default async function KpisPage({
  searchParams,
}: {
  /**
   * The filters, in the url (P6-G30), and the form the address opens.
   *
   * **The explorer's own pattern**: a combination survives a reload and can be
   * sent to somebody, which local state loses on both counts.
   */
  searchParams: Promise<{
    frequency?: string;
    owner?: string;
    category?: string;
    state?: string;
    /** `kpi` or `category`: which form is open. */
    new?: string;
    /** The category the New KPI panel was opened for. */
    in?: string;
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
  const params = await searchParams;
  const filters = Object.fromEntries(
    FILTER_KEYS.flatMap((key) =>
      params[key] === undefined ? [] : [[key, params[key] as string]],
    ),
  ) as Partial<Record<(typeof FILTER_KEYS)[number], string>>;
  const shown = grid.kpis.filter(
    (kpi) =>
      (!filters.frequency || kpi.frequency === filters.frequency) &&
      (!filters.owner || kpi.ownerId === filters.owner) &&
      (!filters.category ||
        (kpi.categoryId ?? UNCATEGORISED) === filters.category) &&
      (!filters.state || kpi.state === filters.state),
  );

  /** The grid's address with one filter changed, the form closed. */
  const href = (patch: Record<string, string | null>): string => {
    const next = new URLSearchParams(filters);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    const text = next.toString();
    return text === "" ? "/kpis" : `/kpis?${text}`;
  };
  /** The grid's address with a form open, the filters kept. */
  const opening = (which: "kpi" | "category"): string => {
    const next = new URLSearchParams(filters);
    next.set("new", which);
    return `/kpis?${next.toString()}`;
  };

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
  const categoryChoices = grid.categories.map((one) => ({
    value: one.id ?? UNCATEGORISED,
    label: one.name,
  }));
  // Today in the workspace calendar, resolved on the server. The grid needs it to
  // draw a column for the current period, and the browser clock is the wrong one.
  const settings = await callAction(context, "settings.readForMember", {});
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: String(settings.settings.timezone ?? "UTC"),
  }).format(new Date());

  // The filters in force, each as the chip that takes it away.
  const named = (
    choices: readonly { value: string; label: string }[],
    value: string,
  ) => choices.find((one) => one.value === value)?.label ?? value;
  const chip = (group: string, value: string) =>
    t("goals.filter.chip", { group, value });
  const active = [
    filters.frequency
      ? {
          key: "frequency",
          label: chip(t("common.frequency"), filters.frequency),
        }
      : null,
    filters.state
      ? {
          key: "state",
          label: chip(
            t("operator.workspaces.columnState"),
            filters.state.replace("_", " "),
          ),
        }
      : null,
    filters.owner
      ? {
          key: "owner",
          label: chip(
            t("common.owner"),
            named(
              owners.map(([value, label]) => ({ value, label })),
              filters.owner,
            ),
          ),
        }
      : null,
    filters.category
      ? {
          key: "category",
          label: chip(
            t("kpis.category"),
            named(categoryChoices, filters.category),
          ),
        }
      : null,
  ].filter((one) => one !== null);

  const panel = (
    <>
      <PanelRow label={t("common.frequency")}>
        <Pill
          href={href({ frequency: null })}
          on={!filters.frequency}
          testId="filter-frequency-all"
        >
          {t("goals.all")}
        </Pill>
        {frequencies.map((one) => (
          <Pill
            key={one}
            href={href({ frequency: one })}
            on={filters.frequency === one}
            testId={`filter-frequency-${one}`}
          >
            {one}
          </Pill>
        ))}
      </PanelRow>
      <PanelRow label={t("operator.workspaces.columnState")}>
        <Pill
          href={href({ state: null })}
          on={!filters.state}
          testId="filter-state-all"
        >
          {t("goals.all")}
        </Pill>
        {states.map((one) => (
          <Pill
            key={one}
            href={href({ state: one })}
            on={filters.state === one}
            testId={`filter-state-${one}`}
          >
            {one.replace("_", " ")}
          </Pill>
        ))}
      </PanelRow>
      {owners.length > 0 ? (
        <PanelRow label={t("common.owner")}>
          <Pill
            href={href({ owner: null })}
            on={!filters.owner}
            testId="filter-owner-all"
          >
            {t("goals.all")}
          </Pill>
          {owners.map(([id, name]) => (
            <Pill
              key={id}
              href={href({ owner: id })}
              on={filters.owner === id}
              testId={`filter-owner-${id}`}
            >
              {name}
            </Pill>
          ))}
        </PanelRow>
      ) : null}
      {categoryChoices.length > 0 ? (
        <PanelRow label={t("kpis.category")}>
          <Pill
            href={href({ category: null })}
            on={!filters.category}
            testId="filter-category-all"
          >
            {t("goals.all")}
          </Pill>
          {/* The KPIs with no category are a choice of their own, not the
           * empty value, which is "All". */}
          {categoryChoices.map((one) => (
            <Pill
              key={one.value}
              href={href({ category: one.value })}
              on={filters.category === one.value}
              testId={`filter-category-${one.value}`}
            >
              {one.label}
            </Pill>
          ))}
        </PanelRow>
      ) : null}
    </>
  );

  const chips =
    active.length === 0
      ? null
      : active.map((one) => (
          <a
            key={one.key}
            href={href({ [one.key]: null })}
            aria-label={t("goals.filter.removeOne", { filter: one.label })}
            className="inline-flex h-6.5 items-center gap-1.5 rounded-full bg-brand-weak pr-1 pl-2.5 text-xs font-semibold text-brand-text hover:bg-brand-line"
          >
            {one.label}
            <svg viewBox="0 0 10 10" aria-hidden="true" className="size-2.5">
              <path
                d="m2 2 6 6M8 2 2 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </a>
        ));

  const recoveryCount = grid.kpis.filter(
    (kpi) => kpi.state === "unhealthy" || kpi.recovering,
  ).length;
  const chosenCategory =
    params.in && grid.categories.some((one) => one.id === params.in)
      ? params.in
      : "";

  return (
    <>
      <AreaTabs area="goals" current="/kpis" t={t} />
      <div className="flex w-full flex-col gap-3.5">
        <section className="rounded-xl border border-line bg-surface">
          <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3.5 max-md:px-3 max-md:py-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-lg font-bold text-ink">
                {t("common.count")}
              </h1>
              {grid.kpis.length === 0 ? (
                <p className="text-xs text-ink-3">
                  {t("kpis.nothingMeasuredYet")}
                </p>
              ) : (
                <CategorySubtotal
                  states={shown.map((kpi) => kpi.state)}
                  recovering={shown.filter((kpi) => kpi.recovering).length}
                  count={kpiCount(t, shown.length)}
                  testId="kpi-summary"
                />
              )}
            </div>
            {canEdit ? (
              <div className="ml-auto flex items-center gap-2 max-md:ml-0 max-md:w-full">
                <a
                  href={opening("category")}
                  className={buttonVariants({ size: "sm" })}
                >
                  {t("kpis.newCategory")}
                </a>
                <a
                  href={opening("kpi")}
                  className={`${buttonVariants({ variant: "primary", size: "sm" })} max-md:flex-1 max-md:justify-center`}
                >
                  {t("kpis.addAKpi")}
                </a>
              </div>
            ) : null}
          </div>
          <GoalsToolbar
            tabs={
              <KpiTabs
                active="/kpis"
                label={t("kpis.tabs")}
                t={t}
                counts={{
                  "/kpis": grid.kpis.length,
                  "/kpis/recovery": recoveryCount,
                }}
              />
            }
            panel={panel}
            chips={chips}
            clearAll={
              active.length === 0 ? null : (
                <a
                  href="/kpis"
                  className="px-1.5 text-[12.5px] font-semibold text-brand-text hover:underline"
                >
                  {t("goals.filter.clearAll")}
                </a>
              )
            }
            activeCount={active.length}
            trailing={
              canEdit ? (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-4 max-md:hidden">
                  <Kbd>{t("common.enter")}</Kbd>
                  <span>{t("kpis.grid.keysEnter")}</span>
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd>
                  <span>{t("kpis.grid.keysMove")}</span>
                </span>
              ) : null
            }
          />
        </section>

        <KpiGrid
          categories={grid.categories}
          kpis={shown}
          canEdit={canEdit}
          today={today}
          addHref={opening("kpi")}
        />
      </div>

      {canEdit ? (
        <>
          <KpiPanel
            which="kpi"
            title={t("kpis.addAKpi")}
            submitLabel={t("common.add")}
            action={addKpi}
            after={suggestionOffered ? <KpiSuggestion /> : null}
          >
            <TextInput
              id="title"
              label={t("kpis.whatIsBeingMeasured")}
              name="title"
              required
              maxLength={500}
              placeholder={t("kpis.mobileActivationRate")}
              inputClassName="placeholder:text-ink-4"
            />
            {grid.categories.some((one) => one.id !== null) ? (
              <SelectInput
                // Keyed by the category it was opened for, so a second
                // "Add a KPI to …" preselects its own.
                key={chosenCategory}
                id="categoryId"
                label={t("kpis.category")}
                name="categoryId"
                defaultValue={chosenCategory}
              >
                <option value="">{t("kpis.noCategory")}</option>
                {grid.categories.flatMap((one) =>
                  one.id === null
                    ? []
                    : [
                        <option key={one.id} value={one.id}>
                          {one.name}
                        </option>,
                      ],
                )}
              </SelectInput>
            ) : null}
            <div className="grid grid-cols-2 gap-2.5">
              <SelectInput
                id="frequency"
                label={t("common.frequency")}
                name="frequency"
                defaultValue="monthly"
              >
                <option value="daily">{t("common.daily")}</option>
                <option value="weekly">{t("common.weekly")}</option>
                <option value="monthly">{t("common.monthly")}</option>
                <option value="quarterly">{t("common.quarterly")}</option>
                <option value="yearly">{t("common.yearly")}</option>
              </SelectInput>
              {/* guided-inputs §4.8: the unit the target is measured in. */}
              <UnitInput
                id="kpi-unit"
                label={t("kpis.unit")}
                name="unit"
                known={grid.kpis.flatMap((kpi) => (kpi.unit ? [kpi.unit] : []))}
              />
            </div>
            <NumberInput
              id="targetDefault"
              label={t("common.standingTarget")}
              name="targetDefault"
            />
            <JudgedBy idPrefix="add" />
            <div className="grid grid-cols-2 gap-2.5">
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
              />
              <SelectInput
                id="tier"
                label={t("kpis.rule.tier")}
                name="tier"
                defaultValue=""
              >
                <option value="">{t("kpis.rule.noTier")}</option>
                <option value="input">{t("kpis.rule.tierInput")}</option>
                <option value="output">{t("kpis.rule.tierOutput")}</option>
                <option value="outcome">{t("kpis.rule.tierOutcome")}</option>
                <option value="impact">{t("kpis.rule.tierImpact")}</option>
              </SelectInput>
            </div>
            <p className="text-xs text-ink-4">
              {t("kpis.theCorridorDefaultsTo")}
            </p>
          </KpiPanel>

          <KpiPanel
            which="category"
            variant="dialog"
            title={t("kpis.newCategory")}
            submitLabel={t("common.add")}
            action={addCategory}
          >
            <TextInput
              id="name"
              label={t("kpis.categoryName")}
              name="name"
              required
              maxLength={120}
              placeholder={t("kpis.revenue")}
              inputClassName="placeholder:text-ink-4"
            />
            <p className="text-xs text-ink-3">
              {t("kpis.categoriesAreHowThe")}
            </p>
          </KpiPanel>
        </>
      ) : null}
    </>
  );
}

const PANEL_LABEL = "text-xs font-semibold text-ink-3 max-md:mt-1.5";

/** One question of the filter panel: its name, then its options. */
function PanelRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <>
      <span aria-hidden="true" className={PANEL_LABEL}>
        {label}
      </span>
      <fieldset
        aria-label={label}
        className="flex min-w-0 flex-wrap items-center gap-1.5"
      >
        {children}
      </fieldset>
    </>
  );
}

/**
 * One option of the panel, a link to the grid with it chosen. Links, not a
 * form, so a combination survives a reload and can be sent to somebody.
 */
function Pill({
  href,
  on,
  testId,
  children,
}: {
  readonly href: string;
  readonly on: boolean;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={on ? "true" : undefined}
      data-testid={testId}
      className={`inline-flex h-6.5 items-center rounded-full border px-2.5 text-xs whitespace-nowrap ${
        on
          ? "border-brand bg-brand-weak font-semibold text-brand-text"
          : "border-line-2 bg-surface font-medium text-ink-2 hover:border-ink-4"
      }`}
    >
      {children}
    </a>
  );
}
