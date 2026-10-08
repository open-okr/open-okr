import { type ActionCallContext, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import Link from "next/link";
import { getTranslations } from "../../../lib/translations";
import { goalTreeNodes } from "../../goal-nodes.ts";
import { KpiTreeRows } from "../../kpis/trees/tree-rows.tsx";
import { GoalTable } from "../../work-map.tsx";

/**
 * A space's own work on its home: its goals and its KPI trees (REQUIREMENTS §4
 * "team homes with their own goals", completeness review M-22).
 *
 * **The same drawings as the screens they come from.** The goals are the Work
 * Map's table and its tree order (`GoalTable`, `goalTreeNodes`), and the KPIs
 * are S-18's rows (`KpiTreeRows`). A space home that drew either its own way
 * would be a second answer to "what does a goal row say".
 *
 * **Every row went through the access getter.** `goals.list` filters goal by
 * goal, and `kpis.spaceTrees` reads through the space, so a reader sees what
 * they could open and nothing else. An empty card therefore says "none you
 * can see", because for a guest that is the truth and "none" would not be.
 *
 * Each card is its own async component, so the page streams it behind a
 * Suspense boundary and a failure in one leaves the rest of the home standing.
 */

export async function SpaceGoals({
  context,
  spaceId,
}: {
  readonly context: ActionCallContext;
  readonly spaceId: string;
}) {
  const { t } = await getTranslations();
  const { goals } = await callAction(context, "goals.list", {
    spaceId,
    includeClosed: false,
  });

  return (
    <section aria-labelledby="space-goals" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 id="space-goals" className="text-sm font-bold text-ink">
          {t("goals.goals")}
        </h2>
        {/* The Work Map scoped to this space is where a cycle can be chosen
            and a row opened in the side panel; this card is the open set. */}
        <Link
          href={`/?scope=${spaceId}`}
          className="text-xs font-semibold text-brand-text hover:underline"
        >
          {t("spaces.detail.openInTheWorkMap")}
        </Link>
      </div>
      <GoalTable
        nodes={goalTreeNodes(t, goals)}
        selected={null}
        rowHref={(node) => `/goals/${node.goalId}`}
        empty={
          <div className="flex flex-col gap-1.5 p-3">
            <p className="text-sm text-ink-2">
              {t("spaces.detail.noGoalsYouCanSee")}
            </p>
            <p className="text-xs text-ink-3">
              {t("goals.objectivesAreDraftedIn")}{" "}
              <a className="underline" href={`/cycle?phase=4&space=${spaceId}`}>
                {t("goals.openDrafting")}
              </a>
            </p>
          </div>
        }
      />
    </section>
  );
}

export async function SpaceKpiTrees({
  context,
  spaceId,
  canEdit,
}: {
  readonly context: ActionCallContext;
  readonly spaceId: string;
  /** Whether an unhealthy KPI offers its recovery, as S-18 decides it. */
  readonly canEdit: boolean;
}) {
  const { t } = await getTranslations();
  const { trees } = await callAction(context, "kpis.spaceTrees", { spaceId });

  return (
    <Card>
      <CardHeader className="justify-between">
        <h2 className="text-sm font-bold text-ink">
          {t("kpis.trees.kpiTrees")}
        </h2>
        <Link
          href="/kpis/trees"
          className="text-xs font-semibold text-brand-text hover:underline"
        >
          {t("spaces.detail.allKpiTrees")}
        </Link>
      </CardHeader>
      <CardBody className="flex flex-col gap-3 p-0">
        {trees.length === 0 ? (
          <p className="p-3 text-sm text-ink-3">
            {t("spaces.detail.noKpisYet")}
          </p>
        ) : (
          trees.map((tree) => {
            const name = tree.name ?? t("kpis.trees.kpisInNoTree");
            return (
              <div key={tree.id ?? "unfiled"} className="flex flex-col">
                <h3 className="px-3 pt-2 text-xs font-semibold text-ink-3">
                  {tree.id ? (
                    <Link
                      href={`/kpis/trees?tree=${tree.id}`}
                      className="hover:underline"
                    >
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                </h3>
                <KpiTreeRows
                  nodes={tree.nodes}
                  canEdit={canEdit}
                  label={name}
                />
              </div>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}
