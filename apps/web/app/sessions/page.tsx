import { callAction } from "@openokr/core";
import {
  buttonVariants,
  Card,
  CardBody,
  CardHeader,
  Chip,
  KeyboardList,
} from "@openokr/ui";
import Link from "next/link";
import { getPool } from "../../lib/auth";
import { nameOf, SESSION_KIND_NAME_KEYS } from "../../lib/identifier-names.ts";
import { NavSelect } from "../../lib/nav-select.tsx";
import { pageTitle } from "../../lib/page-title.ts";
import { CYCLE_TABS, SectionTabs } from "../../lib/section-tabs.tsx";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { ScheduleSessions } from "./schedule.tsx";

export const generateMetadata = pageTitle("pageTitle.sessions");

/**
 * The session list (UIUX-PLAN.md §4 S-22 to S-25, P5-T01c).
 *
 * **Why this page exists.** The four session screens were built across P4-T07
 * to P4-T10 and nothing in the interface linked to any of them. `/session/<id>`
 * was reachable only by typing it, so every session feature in the product was
 * invisible to the people it was built for. This is the door.
 *
 * **Running first, then soonest.** A session in progress is the only row here
 * that somebody is already waiting in, so it sorts above everything and says
 * which step the room is on. After that the list is ordered by when a member
 * has to turn up, which is the question they came to this page with.
 *
 * Finished sessions are behind a link rather than on the page. The front door
 * is about what is next; what happened is the scorecard's job and the digest's.
 */

type Row = Awaited<ReturnType<typeof callAction<"sessions.mine">>>[number];

/** The date a member reads, in the workspace's own words rather than an ISO string. */
function whenLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

async function SessionRow({ row }: { readonly row: Row }) {
  const { t } = await getTranslations();

  const running = row.state === "running";
  return (
    <Link
      href={`/session/${row.id}`}
      className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 transition-colors hover:border-brand hover:bg-raised"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">
            {row.title}
          </span>
          {running ? (
            // The one state that changes what a reader should do next, so it is
            // the one that gets a chip rather than a word in a line of text.
            <Chip tone="brand">{t("common.inProgress")}</Chip>
          ) : null}
          {row.isFacilitator ? (
            <Chip tone="neutral">{t("sessions.youFacilitate")}</Chip>
          ) : null}
        </div>
        <p className="truncate text-xs text-ink-3">
          {nameOf(SESSION_KIND_NAME_KEYS, row.kind, t)}
          {row.spaceName ? ` · ${row.spaceName}` : ""}
          {` · ${whenLabel(row.scheduledFor)}`}
          {running && row.stageKey ? (
            <> · {t("sessions.onStage", { stage: row.stageKey })}</>
          ) : null}
        </p>
      </div>
      <span className="ml-auto flex-none text-xs font-semibold text-brand-text">
        {running ? t("sessions.rejoin") : t("cycle.drafting.open")}
      </span>
    </Link>
  );
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ finished?: string; space?: string }>;
}) {
  const { t } = await getTranslations();

  const { finished, space } = await searchParams;
  const { session, workspace } = await requireWorkspace();
  const includeFinished = finished === "1";

  const rows = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.mine",
    includeFinished ? { includeFinished: true } : {},
  );

  // A team filter, for a facilitator who runs one team's sessions among
  // many (usability review C7). Offered from the spaces the list holds.
  const spaces = [
    ...new Map(
      rows.flatMap((row) =>
        row.spaceId && row.spaceName
          ? [[row.spaceId, row.spaceName] as const]
          : [],
      ),
    ),
  ];
  const activeSpace =
    space && spaces.some(([id]) => id === space) ? space : null;
  const address = (spaceId: string | null): string => {
    const params = new URLSearchParams();
    if (includeFinished) {
      params.set("finished", "1");
    }
    if (spaceId) {
      params.set("space", spaceId);
    }
    const search = params.toString();
    return search ? `/sessions?${search}` : "/sessions";
  };
  const shown = activeSpace
    ? rows.filter((row) => row.spaceId === activeSpace)
    : rows;

  const running = shown.filter((row) => row.state === "running");
  const ahead = shown.filter((row) => row.state === "scheduled");
  const over = shown.filter(
    (row) => row.state === "closed" || row.state === "skipped",
  );

  return (
    <div className="stagger flex flex-col gap-4.5">
      <SectionTabs items={CYCLE_TABS} active="/sessions" />
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-bold text-ink">
              {t("common.sessions")}
            </h1>
            <p className="text-xs text-ink-3">
              {t("sessions.everySessionInA")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {spaces.length > 1 ? (
              <NavSelect
                label={t("workMap.scope.space")}
                value={activeSpace ?? ""}
                testId="sessions-space"
                options={[
                  { value: "", label: t("goals.all"), href: address(null) },
                  ...spaces.map(([id, name]) => ({
                    value: id,
                    label: name,
                    href: address(id),
                  })),
                ]}
              />
            ) : null}
            <Link
              className={buttonVariants({ size: "sm" })}
              href={
                includeFinished
                  ? activeSpace
                    ? `/sessions?space=${activeSpace}`
                    : "/sessions"
                  : activeSpace
                    ? `/sessions?finished=1&space=${activeSpace}`
                    : "/sessions?finished=1"
              }
            >
              {includeFinished
                ? t("sessions.hideFinished")
                : t("sessions.showFinished")}
            </Link>
          </div>
        </CardHeader>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              {t("sessions.noSessionsInThe")}
            </p>
            <p className="mt-1 text-xs text-ink-3">
              {t("sessions.aSessionIsScheduled")}
            </p>
            <Link
              className={`${buttonVariants({ variant: "default", size: "sm" })} mt-3.5 w-fit`}
              href="/spaces"
            >
              {t("sessions.goToSpaces")}
            </Link>
          </CardBody>
        </Card>
      ) : (
        // `j` and `k` walk every session in the three groups (U2).
        <KeyboardList className="flex flex-col gap-4.5">
          <Group label={t("common.inProgress")} rows={running} />
          <Group label={t("sessions.ahead")} rows={ahead} />
          {includeFinished ? (
            <Group label={t("sessions.finished")} rows={over} />
          ) : null}
        </KeyboardList>
      )}

      {/* The scheduler this page's empty state used to send people looking
       * for (completeness review H-08). */}
      <ScheduleSessions />
    </div>
  );
}

function Group({
  label,
  rows,
}: {
  readonly label: string;
  readonly rows: readonly Row[];
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="flex items-center gap-2 px-0.5 text-xs font-bold uppercase tracking-wide text-ink-3">
        {label}
        <span className="rounded-full bg-raised px-1.5 py-0.5 text-xs font-semibold text-ink-3">
          {rows.length}
        </span>
      </h2>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          // A wrapper, so the keys land on the row's link rather than take
          // the link itself out of the tab order.
          <div key={row.id} data-keyboard-row>
            <SessionRow row={row} />
          </div>
        ))}
      </div>
    </section>
  );
}
