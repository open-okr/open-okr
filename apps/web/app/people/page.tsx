import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../lib/access";
import { getPool } from "../../lib/pool";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";

/**
 * The people directory and org chart (UIUX-PLAN.md SS6 S-33, P6-G09).
 *
 * Two tabs, one route: the directory (default) and the org chart. Both are
 * server-rendered from the same data load, with the tab selection carried in
 * a search param so that linking to the chart view works.
 *
 * **No sidebar entry.** SS3 does not list People. The work map links here with
 * "Who is here", matching the pattern Activity established at P6-G11a.
 */

interface OrgChartNode {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly children: readonly OrgChartNode[];
}

function OrgTree({
  nodes,
  depth,
}: {
  readonly nodes: readonly OrgChartNode[];
  readonly depth: number;
}) {
  if (nodes.length === 0) return null;
  return (
    <ul className={depth > 0 ? "ml-5 border-line border-l pl-3" : ""}>
      {nodes.map((node) => (
        <li key={node.id} className="py-1">
          <Link
            href={`/people/${node.id}`}
            className="text-sm text-ink hover:text-brand-text hover:underline"
          >
            {node.name}
          </Link>
          {node.title ? (
            <span className="ml-2 text-xs text-ink-3">{node.title}</span>
          ) : null}
          {node.children.length > 0 ? (
            <OrgTree nodes={node.children} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default async function PeoplePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const pool = getPool();
  const context = {
    pool,
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const isAdmin = level >= ACCESS_LEVELS.full;

  const params = await searchParams;
  const view = params.view === "chart" ? "chart" : "directory";
  const query = (params.q ?? "").toLowerCase();

  const [members, chart] = await Promise.all([
    callAction(context, "people.directory", {
      ...(isAdmin ? { includeSuspended: true } : {}),
    }),
    callAction(context, "people.orgChart", {}),
  ]);

  // Filter out agent-kind members from the directory display.
  // Agents are shown in admin/agents, not here.
  const visible = members.filter((m) => m.kind !== "agent");

  // Client-side search filter.
  const filtered = query
    ? visible.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.title?.toLowerCase().includes(query),
      )
    : visible;

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-bold text-ink">{t("people.people")}</h1>
            <p className="text-sm text-ink-3">
              {t("people.everyoneInThisWorkspace")}
            </p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {/* Tab strip */}
          <div className="flex gap-2 border-line border-b pb-2">
            <Link
              href="/people"
              className={`rounded-md px-2.5 py-1 text-sm font-medium ${
                view === "directory"
                  ? "bg-brand text-on-brand"
                  : "text-ink-3 hover:bg-bg-2 hover:text-ink"
              }`}
            >
              {t("people.directory")}
            </Link>
            <Link
              href="/people?view=chart"
              className={`rounded-md px-2.5 py-1 text-sm font-medium ${
                view === "chart"
                  ? "bg-brand text-on-brand"
                  : "text-ink-3 hover:bg-bg-2 hover:text-ink"
              }`}
            >
              {t("people.orgChart")}
            </Link>
          </div>

          {view === "directory" ? (
            <>
              {/* Search */}
              <form method="get" action="/people" className="flex gap-2">
                <input
                  name="q"
                  type="search"
                  defaultValue={query}
                  placeholder={t("people.searchByNameOr")}
                  className="flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
                <button
                  type="submit"
                  className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
                >
                  {t("shell.search.label")}
                </button>
              </form>

              {/* Member list */}
              {filtered.length === 0 ? (
                <p className="text-sm text-ink-3">
                  {query
                    ? "No members match your search."
                    : "No members in this workspace."}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {filtered.map((member) => (
                    <li key={member.id}>
                      <Link
                        href={`/people/${member.id}`}
                        className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-bg-2"
                      >
                        <span className="flex flex-col">
                          <span className="font-medium text-ink">
                            {member.name}
                          </span>
                          {member.title ? (
                            <span className="text-sm text-ink-3">
                              {member.title}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-2">
                          {member.timezone ? (
                            <span className="text-xs text-ink-4">
                              {member.timezone}
                            </span>
                          ) : null}
                          {member.kind === "guest" ? (
                            <Chip tone="neutral">{t("common.guest")}</Chip>
                          ) : null}
                          {member.kind === "placeholder" ? (
                            <Chip tone="neutral">
                              {t("common.placeholder")}
                            </Chip>
                          ) : null}
                          {isAdmin && member.status === "suspended" ? (
                            <Chip tone="warn">{t("common.suspended")}</Chip>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : /* Org chart */
          (chart as OrgChartNode[]).length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("people.noManagerRelationshipsSet")}
            </p>
          ) : (
            <OrgTree nodes={chart as OrgChartNode[]} depth={0} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
