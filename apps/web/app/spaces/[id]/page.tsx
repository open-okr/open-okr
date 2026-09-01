import { callAction, OperationError } from "@openokr/core";
import { buttonVariants, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { SpaceMembership } from "./space-membership";

/**
 * A space home (TECHNICAL-PLAN §4.2, P3-T01).
 *
 * The shell, deliberately. A space home eventually carries the space's goals,
 * its KPI trees, its weekly session and its feed, and every one of those is a
 * later Phase 3 or Phase 4 task. What is real here is the membership model:
 * who is in the space, in what role, who runs its weekly session, and the join
 * or leave action for the reader.
 */
export default async function SpacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session, workspace } = await requireWorkspace();

  let space: Awaited<ReturnType<typeof callAction<"spaces.read">>>;
  try {
    space = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "spaces.read",
      { id },
    );
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
  const sessions = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.list",
    { spaceId: id },
  );
  const liveOrAhead = sessions.filter(
    (row) => row.state === "running" || row.state === "scheduled",
  );

  // The board, ranked by §11's ladder. Deterministic and needs no provider
  // (P4-T15b-b).
  const board = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "blockers.board",
    { spaceId: id },
  );

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
      </div>
    </AppShellLayout>
  );
}
