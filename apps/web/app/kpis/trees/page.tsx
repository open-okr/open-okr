import { ACCESS_LEVELS, callAction } from "@openokr/core";
import {
  Card,
  CardBody,
  CardHeader,
  NumberInput,
  UnitInput,
} from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/auth";
import { KPI_TABS, SectionTabs } from "../../../lib/section-tabs.tsx";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { ActionForm } from "../../cycle/action-form.tsx";
import { addDriver, addTree, fileIntoTree } from "./actions.ts";
import { KpiTreeRows } from "./tree-rows.tsx";

/**
 * The KPI driver tree (UIUX-PLAN.md §4 S-18, METHOD.md §6.3, P3-T14).
 *
 * The rows are `KpiTreeRows`, shared with the space home since completeness
 * review M-22; why the tree is indented rather than drawn on a canvas is
 * written there.
 *
 * Adding a driver hangs off the node it will drive: the link carries the parent
 * in the URL, so the form always knows what the new KPI is meant to move.
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

  return (
    <div className="flex w-full flex-col gap-3.5">
      <SectionTabs items={KPI_TABS} active="/kpis/trees" />
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-bold text-ink">
              {t("kpis.trees.kpiTrees")}
            </h1>
            <p className="text-xs text-ink-3">
              {t("kpis.trees.eachChildDrivesIts")}
            </p>
          </div>
        </CardHeader>
        {tree.trees.length > 0 ? (
          <CardBody className="flex flex-wrap gap-1.5">
            {tree.trees.map((named) => (
              <Link
                key={named.id}
                href={`/kpis/trees?tree=${named.id}`}
                className={
                  named.id === tree.treeId
                    ? "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
                    : "rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
                }
              >
                {named.name}
              </Link>
            ))}
            <Link
              href="/kpis/trees?tree=none"
              className={
                tree.treeId === null
                  ? "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
                  : "rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
              }
            >
              {t("kpis.trees.noTree")}
            </Link>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {tree.treeId === null
              ? t("kpis.trees.kpisInNoTree")
              : (tree.trees.find((named) => named.id === tree.treeId)?.name ??
                t("goals.tree"))}
          </h2>
        </CardHeader>
        <CardBody className="p-0">
          {tree.nodes.length === 0 ? (
            <p className="p-3 text-sm text-ink-3">
              {t("kpis.trees.nothingInThisTree")}
            </p>
          ) : (
            <KpiTreeRows
              nodes={tree.nodes}
              canEdit={canEdit}
              addDriverHref={(nodeId) =>
                `/kpis/trees?${new URLSearchParams({
                  // Carried so the form returns to the view it was opened
                  // from, including the unfiled one.
                  tree: tree.treeId ?? "none",
                  under: nodeId,
                }).toString()}`
              }
            />
          )}
        </CardBody>
      </Card>

      {canEdit && params.under ? (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {underTitle === undefined
                ? t("kpis.trees.addADriverUnderThisKpi")
                : t("kpis.trees.addADriverUnder", { KPI: underTitle })}
            </h2>
          </CardHeader>
          <CardBody>
            <ActionForm action={addDriver} className="flex flex-col gap-2">
              <input type="hidden" name="parentKpiId" value={params.under} />
              <input type="hidden" name="treeId" value={tree.treeId ?? ""} />
              <label className="sr-only" htmlFor="driver-title">
                {t("kpis.trees.whatTheDriverMeasures")}
              </label>
              <input
                id="driver-title"
                name="title"
                required
                placeholder={t("kpis.trees.qualifiedLeads")}
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-4"
              />
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="text-xs text-ink-3" htmlFor="indicatorType">
                  {t("common.indicator")}
                </label>
                <select
                  id="indicatorType"
                  name="indicatorType"
                  defaultValue="leading"
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
                >
                  <option value="leading">{t("kpis.trees.leading")}</option>
                  <option value="lagging">{t("kpis.trees.lagging")}</option>
                </select>
                <label className="text-xs text-ink-3" htmlFor="driver-freq">
                  {t("common.frequency")}
                </label>
                <select
                  id="driver-freq"
                  name="frequency"
                  defaultValue="monthly"
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
                >
                  <option value="daily">{t("common.daily")}</option>
                  <option value="weekly">{t("common.weekly")}</option>
                  <option value="monthly">{t("common.monthly")}</option>
                  <option value="quarterly">{t("common.quarterly")}</option>
                  <option value="yearly">{t("common.yearly")}</option>
                </select>
                <label className="text-xs text-ink-3" htmlFor="driver-dir">
                  {t("common.betterWhen")}
                </label>
                <select
                  id="driver-dir"
                  name="direction"
                  defaultValue="higher_better"
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
                >
                  <option value="higher_better">{t("common.higher")}</option>
                  <option value="lower_better">{t("common.lower")}</option>
                </select>
              </div>
              {/* guided-inputs §4.8: the target as a number, and the unit
                  it is measured in, which the form did not ask for. */}
              <div className="flex flex-wrap items-end gap-2.5">
                <NumberInput
                  id="driver-target"
                  label={t("common.standingTarget")}
                  name="targetDefault"
                  inputClassName="h-auto w-24 py-1 text-xs"
                />
                <UnitInput
                  id="driver-unit"
                  label={t("kpis.unit")}
                  name="unit"
                  inputClassName="h-auto w-28 py-1 text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
                >
                  {t("kpis.trees.addTheDriver")}
                </button>
                <Link
                  href={`/kpis/trees?tree=${tree.treeId ?? "none"}`}
                  className="text-xs text-ink-3 hover:underline"
                >
                  {t("common.cancel")}
                </Link>
              </div>
              <p className="text-xs text-ink-4">
                {t("kpis.trees.aLeadingDriverIs")}
              </p>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      {canEdit && tree.treeId !== null && tree.nodes.length === 0 ? (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("kpis.trees.fileAKpiInto")}
            </h2>
          </CardHeader>
          <CardBody>
            <ActionForm action={fileIntoTree} className="flex flex-col gap-2">
              <input type="hidden" name="treeId" value={tree.treeId} />
              <label className="sr-only" htmlFor="kpiId">
                {t("kpis.trees.whichKpi")}
              </label>
              <select
                id="kpiId"
                name="kpiId"
                required
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {unfiled.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.title}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
              >
                {t("kpis.trees.fileIt")}
              </button>
              <p className="text-xs text-ink-4">
                {t("kpis.trees.theRootGoesIn")}
              </p>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      {canEdit ? (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("kpis.trees.nameATree")}
            </h2>
          </CardHeader>
          <CardBody>
            <ActionForm action={addTree} className="flex flex-col gap-2">
              <label className="sr-only" htmlFor="name">
                {t("kpis.trees.treeName")}
              </label>
              <input
                id="name"
                name="name"
                required
                placeholder={t("kpis.trees.operatingMargin")}
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-4"
              />
              <button
                type="submit"
                className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
              >
                {t("common.nameIt")}
              </button>
              <p className="text-xs text-ink-4">
                {t("kpis.trees.aWorkspaceMayHave")}
              </p>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("common.notHereYet")}
          </h2>
        </CardHeader>
        <CardBody>
          <ul className="flex flex-col gap-1 text-xs text-ink-3">
            <li>{t("kpis.trees.theRightHandPanel")}</li>
            <li>{t("kpis.trees.draggingANodeOnto")}</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
