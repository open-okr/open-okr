import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import type { ResolvedThresholds } from "@openokr/method";
import { buttonVariants, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
import { FeedPanel } from "../../../lib/feed-panel.tsx";
import { WatchControl } from "../../../lib/watch-control.tsx";
import { WeeklyFigures } from "../../../lib/weekly-figures.tsx";
import { requireWorkspace } from "../../../lib/workspace";
import { SpaceManagement } from "./manage.tsx";
import { SpaceMembership } from "./space-membership";
import { SpaceSettingsCard } from "./space-settings.tsx";

/**
 * A space home (TECHNICAL-PLAN §4.2, P3-T01).
 *
 * Started as a shell carrying only the membership model. It now answers "how
 * is this team doing": the confidence trend and the streak (P6-G19c), last
 * week's digest as the room read it, the open blocker board (P4-T15b-b), the
 * sessions ahead (P5-T01c) and who is in the space in what role.
 *
 * Still absent: the space's goals and its KPI trees, which have their own
 * screens and are reached from the rail.
 */
export default async function SpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** The feed's cursor, which is the only thing this page reads (P6-G11b). */
  searchParams: Promise<{ at?: string; id?: string }>;
}) {
  const { id } = await params;
  const { session, workspace } = await requireWorkspace();
  // Built once. It was written out at each call site, and P6-G19c would have
  // added three more copies of it.
  const actor = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  // The feed for this surface (S-31, P6-G11b). Both halves of the cursor or
  // neither: a half cursor is a link somebody edited by hand.
  const feedParams = await searchParams;
  const feedCursor =
    feedParams.at && feedParams.id
      ? { at: feedParams.at, id: feedParams.id }
      : undefined;
  const [feedItems, feedDirectory, feedSettings] = await Promise.all([
    callAction(actor, "activities.spaceFeed", {
      spaceId: id,
      ...(feedCursor ? { cursor: feedCursor } : {}),
    }),
    callAction(actor, "people.directory", {}),
    callAction(actor, "settings.readWorkspaceSettings", {}),
  ]);
  const feedNames = new Map(
    feedDirectory.map((member) => [member.id, member.name]),
  );

  // Whether this reader is watching this subject (P6-G07b). Read here rather
  // than in the control, because the control is a client component and the
  // answer is part of the page's own first paint.
  const watch = await callAction(actor, "subscriptions.read", {
    subjectType: "space",
    subjectId: id,
  });

  let space: Awaited<ReturnType<typeof callAction<"spaces.read">>>;
  try {
    space = await callAction(actor, "spaces.read", { id });
  } catch (error) {
    // A space the reader may not see is indistinguishable from one that does
    // not exist (§8.1 layer 2).
    if (error instanceof OperationError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  // This space's own sessions (P5-T01c). The space is where a session is
  // scheduled and run, so this is the entry point that matters most: a
  // facilitator opening their team home should see the room they are about to
  // run without going anywhere else first.
  const sessions = await callAction(actor, "sessions.list", { spaceId: id });
  const liveOrAhead = sessions.filter(
    (row) => row.state === "running" || row.state === "scheduled",
  );

  // The board, ranked by §11's ladder. Deterministic and needs no provider
  // (P4-T15b-b).
  const board = await callAction(actor, "blockers.board", { spaceId: id });

  // **The team's own week (P6-G19c, GAP-AUDIT B-10).** The trend, the streak
  // and the last closed week's figures. The blocker board below already
  // arrived at P4-T15b-b; these are the three the space home was missing.
  //
  // The reads are scoped by the same context every other read on this page
  // uses, and `spaces.read` above has already answered not-found for a space
  // the reader may not see, so there is nothing extra to refuse here.
  const TREND_WEEKS = 12;
  const [trend, streak, rhythm] = await Promise.all([
    callAction(actor, "sessions.confidenceTrend", {
      spaceId: id,
      weeks: TREND_WEEKS,
    }),
    callAction(actor, "sessions.readStreak", { spaceId: id }),
    callAction(actor, "rhythm.read", {}),
  ]);

  // Last week is the last session this space closed, and its digest is what
  // the room read at the time. A running session is deliberately not it: the
  // figures move until it closes.
  const lastClosed = sessions
    .filter((row) => row.state === "closed")
    .sort((left, right) =>
      right.scheduledFor.localeCompare(left.scheduledFor),
    )[0];
  const lastWeek = lastClosed
    ? await callAction(actor, "sessions.digest", { sessionId: lastClosed.id })
    : null;

  // Managing a space (P6-G18a). `spaces.update`, `addMember`, `setMemberRole`
  // and `removeMember` all declare `edit`, which a space manager holds through
  // their own binding; `archive` declares `full`, because a space is where a
  // team's whole history lives. The controls are drawn to match, and each
  // action refuses independently.
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canManage = level >= ACCESS_LEVELS.full || space.ownRole === "manager";
  const candidates = canManage
    ? (await callAction(actor, "people.directory", {})).filter(
        (member) =>
          !space.members.some((inSpace) => inSpace.memberId === member.id),
      )
    : [];

  return (
    <AppShellLayout>
      <div className="stagger flex flex-col gap-4.5">
        <Card>
          <CardHeader>
            <h1 className="text-lg font-bold text-ink">{space.name}</h1>
            {space.mission ? (
              <p className="text-sm text-ink-3">{space.mission}</p>
            ) : null}
          </CardHeader>
          <CardBody className="flex flex-col gap-3.5">
            <SpaceMembership spaceId={space.id} ownRole={space.ownRole} />
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-ink-2">
                Members ({space.memberCount})
              </h2>
              <ul className="flex flex-col gap-1.5">
                {space.members.map((member) => (
                  <li
                    key={member.memberId}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-ink">{member.name}</span>
                    <span className="flex items-center gap-2">
                      <Chip
                        tone={member.role === "member" ? "neutral" : "brand"}
                      >
                        {member.role}
                      </Chip>
                      {member.memberId === space.coordinatorMemberId ? (
                        <Chip tone="info">runs the weekly session</Chip>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {space.coordinatorMemberId &&
              !space.members.some(
                (member) =>
                  member.memberId === space.coordinatorMemberId &&
                  member.role === "coordinator",
              ) ? (
                <p className="text-sm text-ink-3">
                  No coordinator is named, so a manager covers those duties.
                </p>
              ) : null}
            </div>
          </CardBody>
        </Card>

        {/* §4.14's space scope (P6-G18b). Placed under the management card
            because it is the same audience and the rarer thing to change. */}
        <SpaceSettingsCard
          spaceId={space.id}
          settings={space.settings}
          workspaceStrictness={rhythm.coachStrictness}
          workspaceFrequency={rhythm.defaultCheckInFrequency}
          canManage={canManage}
        />

        <SpaceManagement
          spaceId={space.id}
          name={space.name}
          mission={space.mission}
          members={space.members}
          candidates={candidates.map((member) => ({
            id: member.id,
            name: member.name,
          }))}
          canManage={canManage}
          canArchive={level >= ACCESS_LEVELS.full}
        />

        <WeeklyFigures
          trend={[...trend]}
          streakWeeks={streak.currentWeeks}
          weeks={TREND_WEEKS}
          thresholds={rhythm.thresholds as unknown as ResolvedThresholds}
        />

        {/* Last week's figures, as the digest recorded them (P6-G19c). */}
        <Card>
          <CardHeader className="justify-between">
            <span>Last week</span>
            {lastWeek ? (
              <span className="text-xs text-ink-3">
                week of {lastWeek.weekStart}
              </span>
            ) : null}
            <WatchControl subjectType="space" subjectId={id} initial={watch} />
          </CardHeader>
          <CardBody>
            {lastWeek === null ? (
              <p className="text-sm text-ink-3">
                No week has closed in this space yet. The first digest is
                written when a weekly session closes.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {lastWeek.lines.map((line) => (
                  <li key={line} className="text-sm text-ink-2">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* P5-T01c: the door to S-22 to S-25, which nothing linked to. */}
        <Card>
          <CardHeader className="justify-between">
            <span>Sessions</span>
            <Link
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href="/sessions"
            >
              All sessions
            </Link>
          </CardHeader>
          <CardBody>
            {liveOrAhead.length === 0 ? (
              <p className="text-sm text-ink-3">
                Nothing scheduled in this space.
              </p>
            ) : (
              <ul aria-label="Sessions" className="flex flex-col gap-1.5">
                {liveOrAhead.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/session/${row.id}`}
                      className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 transition-colors hover:border-brand hover:bg-raised"
                    >
                      <span className="truncate text-sm font-medium text-ink">
                        {row.title}
                      </span>
                      {row.state === "running" ? (
                        <Chip tone="brand">In progress</Chip>
                      ) : null}
                      <span className="ml-auto flex-none text-xs font-semibold text-brand-text">
                        {row.state === "running" ? "Rejoin" : "Open"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* P4-T15b-b: the open-blocker board REQUIREMENTS §7 asks for. */}
        <Card>
          <CardHeader>Open blockers</CardHeader>
          <CardBody>
            {board.blockers.length === 0 ? (
              <p className="text-sm text-ink-3">
                Nothing is stuck in this space.
              </p>
            ) : (
              <ol aria-label="Open blockers" className="flex flex-col gap-2.5">
                {board.blockers.map((blocker) => (
                  <li key={blocker.id} className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Chip tone="neutral">
                        {blocker.type.replace("_", " ")}
                      </Chip>
                      {blocker.pastTheClock ? (
                        <Chip tone="bad">past the clock</Chip>
                      ) : null}
                      {blocker.escalation === "none" ? null : (
                        <Chip tone="warn">
                          escalated to {blocker.escalation}
                        </Chip>
                      )}
                      <span className="text-xs text-ink-4">
                        {blocker.ageHours}h
                      </span>
                    </span>
                    <p className="text-sm text-ink">{blocker.nextAction}</p>
                    <p className="text-xs text-ink-3">
                      {blocker.ownerName ?? "No owner named"}
                      {blocker.blockedTitle
                        ? ` · blocks ${blocker.blockedTitle}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
        <FeedPanel
          title="Activity"
          explains="What has happened in this space, including its goals, initiatives and tasks."
          items={feedItems}
          names={feedNames}
          timeZone={String(feedSettings.settings.timezone ?? "UTC")}
          basePath={`/spaces/${id}`}
          paged={feedCursor !== undefined}
          live={{ scope: "space", subjectId: id }}
        />
      </div>
    </AppShellLayout>
  );
}
