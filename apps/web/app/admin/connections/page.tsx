import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { getInstanceName } from "../../../lib/instance-name";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { endConnection } from "./actions.ts";
import { EndConnectionForm } from "./end-form.tsx";

export const generateMetadata = pageTitle("pageTitle.adminConnections");

/**
 * Admin, Agent connections: part of S-37 (agent-connections-admin.md, plan
 * 0.7.0 A4, approved 9 November 2026).
 *
 * Every member's external agent connections and agent tokens, and an End
 * control for each live one. The admin layout already requires `full`, and
 * both actions require it again and refuse anything but the signed-in
 * browser. Shown with AI off: an external agent needs no AI provider (D9).
 * Never a token, a code, a hash, a redirect address or an email (D11).
 */
export const dynamic = "force-dynamic";

const STATES = ["live", "ended", "all"] as const;
type State = (typeof STATES)[number];

const STATE_LABEL: Record<State, string> = {
  live: "admin.connections.filterLive",
  ended: "admin.connections.filterEnded",
  all: "admin.connections.filterAll",
};

export default async function AdminConnectionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const state: State = STATES.find((one) => one === params.state) ?? "live";
  const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);
  const { t } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const { items, hasMore } = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
      instanceName: await getInstanceName(),
    },
    "connections.list",
    { state, page },
  );

  return (
    <div className="flex w-full flex-col gap-3.5">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="text-lg font-bold text-ink">
              {t("admin.connections.title")}
            </h1>
            <p className="text-xs text-ink-3">{t("admin.connections.lead")}</p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <nav
            aria-label={t("admin.connections.filters")}
            className="flex flex-wrap gap-2"
          >
            {STATES.map((one) => (
              <Link
                key={one}
                href={`/admin/connections?state=${one}`}
                aria-current={one === state ? "page" : undefined}
                className="rounded-control border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-line-2 aria-[current=page]:border-brand-line aria-[current=page]:text-ink"
              >
                {t(STATE_LABEL[one])}
              </Link>
            ))}
          </nav>
          {items.length === 0 ? (
            <p className="text-xs text-ink-3" data-testid="connections-empty">
              {state === "live"
                ? t("admin.connections.noneLive")
                : t("admin.connections.none")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li
                  key={`${item.kind}-${item.id}`}
                  className="flex flex-col gap-1 rounded-lg border border-line p-3"
                  data-testid="admin-connection"
                >
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {item.memberName}
                    {item.memberActive ? null : (
                      <Chip tone="warn">
                        {t("admin.connections.suspended")}
                      </Chip>
                    )}
                    <span className="text-ink-3">·</span>
                    {item.label}
                    <Chip tone="neutral">
                      {item.kind === "grant"
                        ? t("admin.connections.kindGrant")
                        : t("admin.connections.kindToken")}
                    </Chip>
                    {item.revokedAt ? (
                      <Chip tone="bad">{t("common.revoked")}</Chip>
                    ) : (
                      <Chip tone="ok">{t("common.active")}</Chip>
                    )}
                    {item.scopes.map((scope) => (
                      <Chip key={scope} tone="neutral">
                        {scope}
                      </Chip>
                    ))}
                  </span>
                  <span className="text-xs text-ink-3">
                    {item.lastUsedAt
                      ? t("account.connections.lastUsedConnected", {
                          lastUsed: item.lastUsedAt.slice(0, 10),
                          connected: item.createdAt.slice(0, 10),
                        })
                      : t("account.connections.neverUsedConnected", {
                          connected: item.createdAt.slice(0, 10),
                        })}
                  </span>
                  {item.revokedReason ? (
                    <span className="text-xs text-bad">
                      {item.revokedReason}
                    </span>
                  ) : null}
                  <span className="flex flex-wrap items-center gap-3">
                    <Link
                      className="text-brand-text text-xs hover:underline"
                      href={`/admin/audit?actorMemberId=${item.memberId}`}
                    >
                      {t("admin.connections.whatTheyDid")}
                    </Link>
                    {item.revokedAt ? null : (
                      <EndConnectionForm
                        action={endConnection}
                        kind={item.kind}
                        id={item.id}
                        memberName={item.memberName}
                        label={item.label}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {page > 0 || hasMore ? (
            <nav className="flex gap-3 text-xs">
              {page > 0 ? (
                <Link
                  className="text-brand-text hover:underline"
                  href={`/admin/connections?state=${state}&page=${page - 1}`}
                >
                  {t("admin.connections.newer")}
                </Link>
              ) : null}
              {hasMore ? (
                <Link
                  className="text-brand-text hover:underline"
                  href={`/admin/connections?state=${state}&page=${page + 1}`}
                >
                  {t("admin.connections.older")}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
