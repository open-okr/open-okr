import { ACCESS_LEVELS, callAction } from "@openokr/core";
import {
  Button,
  buttonVariants,
  EntityPicker,
  NumberInput,
  SelectInput,
  TextInput,
  UnitInput,
} from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AreaTabs } from "../../../lib/area-tabs.tsx";
import { getPool } from "../../../lib/auth";
import { pageTitle } from "../../../lib/page-title.ts";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { ActionForm } from "../../cycle/action-form.tsx";
import { GoalsToolbar } from "../../goals/goals-toolbar.tsx";
import { KpiPanel } from "../kpi-panel.tsx";
import { KpiTabs, kpiTabCounts } from "../kpi-tabs.tsx";
import { addDriver, addTree, fileIntoTree } from "./actions.ts";
import { KpiTreeRows } from "./tree-rows.tsx";

export const generateMetadata = pageTitle("pageTitle.trees");

/**
 * The KPI driver tree (UIUX-PLAN.md §4 S-18, METHOD.md §6.3, P3-T14).
 *
 * The rows are `KpiTreeRows`, shared with the space home since completeness
 * review M-22; why the tree is indented rather than drawn on a canvas is
 * written there.
 *
 * Adding a driver hangs off the node it will drive: the link carries the parent
 * in the URL, so the form always knows what the new KPI is meant to move.
 *
 * **KPI redesign (2 November 2026).** The same card as the grid, with the
 * trees as tabs under it; Add driver opens a side panel (`?under=…&new=driver`)
 * and Name a tree a dialog (`?new=tree`), each with every field it had. The
 * "Not here yet" card is gone from the screen: S-18's right-hand edit panel and
 * re-parenting by dragging are still not built, and re-parenting works through
 * the KPI's own page.
 */
export default async function KpiTreesPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly tree?: string;
    readonly under?: string;
  }>;
}) {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const params = await searchParams;

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;
  // `?tree=none` is the KPIs in no tree at all. Without it, naming one tree
  // would hide every unfiled KPI and there would be nothing left to file.
  const tree = await callAction(context, "kpis.tree", {
    ...(params.tree === "none"
      ? { treeId: null }
      : params.tree
        ? { treeId: params.tree }
        : {}),
  });
  // Only the filing control needs this, and only while a named tree is empty.
  const unfiled =
    tree.treeId !== null && tree.nodes.length === 0
      ? (await callAction(context, "kpis.tree", { treeId: null })).nodes
      : [];
  const underTitle = params.under
    ? tree.nodes.find((node) => node.id === params.under)?.title
    : undefined;

  const viewHref = (id: string) => `/kpis/trees?tree=${id}`;
  const current = tree.treeId ?? "none";
  const counts = await kpiTabCounts(context);

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
              <p className="text-xs text-ink-3">
                {t("kpis.trees.eachChildDrivesIts")}
              </p>
            </div>
            {canEdit ? (
              <Link
                href={`/kpis/trees?tree=${current}&new=tree`}
                className={`${buttonVariants({ variant: "primary", size: "sm" })} ml-auto max-md:ml-0 max-md:w-full max-md:justify-center`}
              >
                {t("kpis.trees.newTree")}
              </Link>
            ) : null}
          </div>
          <GoalsToolbar
            tabs={
              <KpiTabs
                active="/kpis/trees"
                label={t("kpis.tabs")}
                t={t}
                counts={counts}
              />
            }
            panel={null}
            chips={null}
            clearAll={null}
            activeCount={0}
          />
        </section>

        {tree.trees.length > 0 ? (
          <nav
            aria-label={t("kpis.trees.kpiTrees")}
            className="flex gap-0.5 overflow-x-auto border-b border-line [scrollbar-width:none]"
          >
            {[
              ...tree.trees.map((named) => ({
                id: named.id,
                name: named.name,
              })),
              { id: "none", name: t("kpis.trees.noTree") },
            ].map((named) => (
              <Link
                key={named.id}
                href={viewHref(named.id)}
                aria-current={named.id === current ? "page" : undefined}
                className={`-mb-px border-b-2 px-2.5 pt-1 pb-2 text-[13px] whitespace-nowrap ${
                  named.id === current
                    ? "border-brand font-semibold text-brand-text"
                    : "border-transparent font-medium text-ink-3 hover:text-ink"
                }`}
              >
                {named.name}
              </Link>
            ))}
          </nav>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-line bg-surface">
          <h2 className="sr-only">
            {tree.treeId === null
              ? t("kpis.trees.kpisInNoTree")
              : (tree.trees.find((named) => named.id === tree.treeId)?.name ??
                t("goals.tree"))}
          </h2>
          {tree.nodes.length === 0 ? (
            <p className="p-4 text-sm text-ink-3">
              {t("kpis.trees.nothingInThisTree")}
            </p>
          ) : (
            <KpiTreeRows
              nodes={tree.nodes}
              canEdit={canEdit}
              addDriverHref={(nodeId) =>
                `/kpis/trees?${new URLSearchParams({
                  // Carried so the panel returns to the view it was opened
                  // from, including the unfiled one.
                  tree: current,
                  under: nodeId,
                  new: "driver",
                }).toString()}`
              }
            />
          )}
        </section>

        {canEdit && tree.treeId !== null && tree.nodes.length === 0 ? (
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-2.5 text-sm font-bold text-ink">
              {t("kpis.trees.fileAKpiInto")}
            </h2>
            <ActionForm action={fileIntoTree} className="flex flex-col gap-2">
              <input type="hidden" name="treeId" value={tree.treeId} />
              <EntityPicker
                id="kpiId"
                label={t("kpis.trees.whichKpi")}
                hideLabel
                name="kpiId"
                required
                options={unfiled.map((node) => ({
                  id: node.id,
                  label: node.title,
                }))}
                className="max-w-96"
              />
              <Button type="submit" variant="primary" className="self-start">
                {t("kpis.trees.fileIt")}
              </Button>
              <p className="text-xs text-ink-4">
                {t("kpis.trees.theRootGoesIn")}
              </p>
            </ActionForm>
          </section>
        ) : null}
      </div>

      {canEdit && params.under ? (
        <KpiPanel
          which="driver"
          clear={["new", "under"]}
          title={
            underTitle === undefined
              ? t("kpis.trees.addADriverUnderThisKpi")
              : t("kpis.trees.addADriverUnder", { KPI: underTitle })
          }
          submitLabel={t("kpis.trees.addTheDriver")}
          action={addDriver}
        >
          <input type="hidden" name="parentKpiId" value={params.under} />
          <input type="hidden" name="treeId" value={tree.treeId ?? ""} />
          <TextInput
            id="driver-title"
            label={t("kpis.trees.whatTheDriverMeasures")}
            name="title"
            required
            maxLength={500}
            placeholder={t("kpis.trees.qualifiedLeads")}
            inputClassName="placeholder:text-ink-4"
          />
          <div className="grid grid-cols-2 gap-2.5">
            <SelectInput
              id="indicatorType"
              label={t("common.indicator")}
              name="indicatorType"
              defaultValue="leading"
            >
              <option value="leading">{t("kpis.trees.leading")}</option>
              <option value="lagging">{t("kpis.trees.lagging")}</option>
            </SelectInput>
            <SelectInput
              id="driver-freq"
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
          </div>
          <SelectInput
            id="driver-dir"
            label={t("common.betterWhen")}
            name="direction"
            defaultValue="higher_better"
          >
            <option value="higher_better">{t("common.higher")}</option>
            <option value="lower_better">{t("common.lower")}</option>
          </SelectInput>
          {/* guided-inputs §4.8: the target as a number, and the unit it is
              measured in. */}
          <div className="grid grid-cols-2 gap-2.5">
            <NumberInput
              id="driver-target"
              label={t("common.standingTarget")}
              name="targetDefault"
            />
            <UnitInput id="driver-unit" label={t("kpis.unit")} name="unit" />
          </div>
          <p className="text-xs text-ink-4">
            {t("kpis.trees.aLeadingDriverIs")}
          </p>
        </KpiPanel>
      ) : null}

      {canEdit ? (
        <KpiPanel
          which="tree"
          variant="dialog"
          title={t("kpis.trees.nameATree")}
          submitLabel={t("common.nameIt")}
          action={addTree}
        >
          <TextInput
            id="name"
            label={t("kpis.trees.treeName")}
            name="name"
            required
            maxLength={120}
            placeholder={t("kpis.trees.operatingMargin")}
            inputClassName="placeholder:text-ink-4"
          />
          <p className="text-xs text-ink-3">
            {t("kpis.trees.aWorkspaceMayHave")}
          </p>
        </KpiPanel>
      ) : null}
    </>
  );
}
