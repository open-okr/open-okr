import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Bar, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../lib/access";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { Composer, Votes } from "./composer.tsx";
import { Timeline } from "./timeline.tsx";
import type { VoteState } from "./vote-panel.tsx";

/**
 * The check-in composer and the session walker (UIUX-PLAN.md §4 S-15, P3-T07).
 *
 * Without `?goal=`, this is the walker: every goal the reader champions that is
 * due, soonest first, with what each one still needs. With one, it is the composer
 * for that goal plus its timeline.
 *
 * The walker lists only the reader's own goals, because METHOD.md §2.5 puts the
 * check-in on the champion. Asking anybody else to post one is asking the wrong
 * person, however much access they hold.
 *
 * A draft is opened lazily, on arriving at a goal, and reopened rather than
 * duplicated. That is what makes the walker resumable: leaving halfway through and
 * coming back finds the same draft.
 */
export default async function CheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ goal?: string }>;
}) {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;

  const { goals: due } = await callAction(context, "goals.due", {
    withinDays: 2,
  });
  const requested = (await searchParams).goal ?? null;

  // The goal after this one in the walker, so publishing can offer to continue.
  const index = requested ? due.findIndex((goal) => goal.id === requested) : -1;
  const nextGoalId = index >= 0 ? (due[index + 1]?.id ?? null) : null;

  // A goal stays on screen after it is published even though it has just left the
  // due list, because publishing advanced its cadence. Dropping the reader back to
  // an empty walker the moment they finish would hide the very card they wrote.
  const stillDue = index >= 0;

  return (
    <AppShellLayout>
      <div className="mx-auto flex max-w-3xl flex-col gap-4.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex flex-col">
              <h1 className="text-lg font-bold text-ink">Check in</h1>
              <p className="text-xs text-ink-3">
                {due.length === 0
                  ? "Nothing of yours is due."
                  : `${due.length} of your goals ${due.length === 1 ? "is" : "are"} due or nearly due, soonest first.`}
              </p>
            </div>
            <Chip tone={due.length === 0 ? "ok" : "brand"}>
              {due.length} due
            </Chip>
          </CardHeader>
          {due.length > 0 ? (
            <CardBody className="flex flex-col gap-1 p-2">
              {due.map((goal) => {
                const active = goal.id === requested;
                return (
                  <a
                    key={goal.id}
                    href={`/check-in?goal=${goal.id}`}
                    aria-current={active ? "step" : undefined}
                    className={
                      active
                        ? "flex items-start gap-2.5 rounded-md border border-brand-line bg-brand-weak p-2.5"
                        : "flex items-start gap-2.5 rounded-md border border-transparent p-2.5 hover:bg-raised"
                    }
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span
                        className={
                          active
                            ? "text-sm font-bold text-brand-text"
                            : "text-sm font-semibold text-ink"
                        }
                      >
                        {goal.title}
                      </span>
                      <span className="text-xs text-ink-3">
                        {goal.level} · {goal.keyResultCount} key result
                        {goal.keyResultCount === 1 ? "" : "s"} ·{" "}
                        {goal.daysPastDue !== null && goal.daysPastDue > 0
                          ? `${goal.daysPastDue} day${goal.daysPastDue === 1 ? "" : "s"} overdue`
                          : `due ${goal.nextCheckInOn}`}
                        {goal.hasOpenDraft ? " · draft open" : ""} ·{" "}
                        {goal.health.replace("_", " ")}
                      </span>
                      <span className="flex items-center gap-2">
                        {/* No tone on the fill. Rule 2 of the colour system: progress is
                            not health, and a goal can be at 90 percent and still
                            be off track. The health word sits beside it instead. */}
                        <Bar
                          value={goal.progressPct}
                          className="h-1.5 flex-1"
                        />
                        <span className="text-xs font-semibold text-ink-3">
                          {Math.round(goal.progressPct)}%
                        </span>
                      </span>
                    </span>
                  </a>
                );
              })}
            </CardBody>
          ) : null}
        </Card>

        {requested ? (
          <CheckInForGoal
            context={context}
            goalId={requested}
            canEdit={canEdit}
            nextGoalId={nextGoalId}
            stillDue={stillDue}
          />
        ) : due.length > 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-ink-3">
                Pick a goal above to start. The walker keeps your place: a draft
                is reopened rather than started again.
              </p>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody>
              <p className="text-sm text-ink-3">
                Nothing to do here today. A goal appears in this list when its
                next check-in is due, or within two days of it.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </AppShellLayout>
  );
}

/**
 * One goal's composer, its votes and its timeline.
 *
 * The draft is opened here rather than on the walker page, so arriving at the list
 * never writes anything. Opening the composer is the act that creates one.
 */
async function CheckInForGoal({
  context,
  goalId,
  canEdit,
  nextGoalId,
  stillDue,
}: {
  readonly context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  };
  readonly goalId: string;
  readonly canEdit: boolean;
  readonly nextGoalId: string | null;
  /** False once this goal's cadence has moved past today, which publishing does. */
  readonly stillDue: boolean;
}) {
  const goal = await callAction(context, "goals.read", { id: goalId });
  const timeline = await callAction(context, "goals.checkIns", {
    goalId,
    includeDrafts: true,
  });

  // A draft is only opened for a goal that is actually due. Opening one just
  // because somebody looked at a goal they have already reported on would leave
  // empty drafts behind every time a page was read.
  const draft =
    canEdit && stillDue
      ? await callAction(context, "goals.startCheckIn", { goalId })
      : null;

  const votes: VoteState[] = [];
  for (const keyResult of goal.keyResults) {
    const state = await callAction(context, "goals.readVotes", {
      keyResultId: keyResult.id,
    });
    votes.push({ keyResultId: keyResult.id, title: keyResult.title, ...state });
  }

  return (
    <>
      {draft ? (
        <Composer
          checkInId={draft.id}
          goalTitle={goal.title}
          keyResults={goal.keyResults}
          nextGoalId={nextGoalId}
        />
      ) : (
        <Card>
          <CardHeader className="justify-between">
            <h2 className="text-sm font-bold text-ink">{goal.title}</h2>
            <Chip tone={stillDue ? "neutral" : "ok"}>
              {stillDue ? "not yours to report" : "reported"}
            </Chip>
          </CardHeader>
          <CardBody className="flex flex-col gap-1.5">
            <p className="text-sm text-ink-3">
              {stillDue
                ? "You can read this goal's check-ins but not post one. The champion posts them (METHOD.md §2.5)."
                : `This goal is not due. Its next check-in is ${goal.nextCheckInOn ?? "not scheduled"}, and the card below is what was reported.`}
            </p>
            {nextGoalId ? (
              <p className="text-xs text-ink-3">
                <a className="underline" href={`/check-in?goal=${nextGoalId}`}>
                  Continue to your next due goal
                </a>
              </p>
            ) : null}
          </CardBody>
        </Card>
      )}

      <Votes votes={votes} canReveal={canEdit} />

      <Timeline
        checkIns={timeline.checkIns}
        reviewerId={goal.reviewer.id}
        canEdit={canEdit}
      />
    </>
  );
}
