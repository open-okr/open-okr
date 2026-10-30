import { ACCESS_LEVELS, callAction } from "@openokr/core";
import type { ResolvedPractice, ResolvedThresholds } from "@openokr/method";
import { Bar, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { workspaceReaderLevel } from "../../lib/access";
import { getPool } from "../../lib/auth";
import { progressCeiling } from "../../lib/ceilings.ts";
import { healthWord } from "../../lib/health-words.ts";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { Composer, Votes } from "./composer.tsx";
import { RaiseBlocker } from "./raise-blocker.tsx";
import { Timeline } from "./timeline.tsx";
import type { VoteState } from "./vote-panel.tsx";

/**
 * The check-in composer and the session walker (UIUX-PLAN.md §4 S-15, P3-T07).
 *
 * Without `?goal=`, this is the walker: every goal the reader champions that is
 * due, soonest first, with what each one still needs, and below it the rest of
 * their goals under "Update any time". With one, it is the composer for that
 * goal plus its timeline.
 *
 * **Any day, not only when due** (OKRGoal UX review, H1 and T7). A member with
 * news on Wednesday posts it as an extra update: the cadence engine leaves the
 * due date where it is (METHOD.md §7.1), so next Monday is still owed and
 * nudged. The Review inbox lists every goal the member champions, and this page
 * now lists the same ones, so the two cannot disagree about what is owed.
 *
 * The walker lists only the reader's own goals, because METHOD.md §2.5 puts the
 * check-in on the champion. Asking anybody else to post one is asking the wrong
 * person, however much access they hold.
 *
 * A draft is opened lazily, on arriving at a goal, and reopened rather than
 * duplicated. That is what makes the walker resumable: leaving halfway through and
 * coming back finds the same draft.
 */
/** How far ahead a goal counts as due now, the walker's two-day lead. */
const DUE_LEAD_DAYS = 2;

export default async function CheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ goal?: string; update?: string }>;
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

  // P8-G04. Resolved once here rather than inside the loop below, because
  // a bar on a 0-to-100 track under a raised ceiling fills early. After the
  // level, because it reads a workspace setting a guest cannot (L-23).
  const ceiling = await progressCeiling();

  // Every goal the reader champions with a next check-in, due or not: a year
  // ahead covers a monthly cadence. The walker is the ones inside the
  // two-day lead; the rest can take an update any day.
  const { goals: mine } = await callAction(context, "goals.due", {
    withinDays: 366,
  });
  const due = mine.filter(
    (goal) => goal.daysPastDue !== null && goal.daysPastDue >= -DUE_LEAD_DAYS,
  );
  const later = mine.filter((goal) => !due.includes(goal));
  const params = await searchParams;
  const requested = params.goal ?? null;

  // The goal after this one in the walker, so publishing can offer to continue.
  const index = requested ? due.findIndex((goal) => goal.id === requested) : -1;
  const nextGoalId = index >= 0 ? (due[index + 1]?.id ?? null) : null;

  // A goal stays on screen after it is published even though it has just left the
  // due list, because publishing advanced its cadence. Dropping the reader back to
  // an empty walker the moment they finish would hide the very card they wrote.
  const stillDue = index >= 0;
  // Not due yet and the reader's own: offered as an update, and opened as one
  // only on asking, so reading the page never leaves an empty draft behind.
  const updatable = !stillDue && later.some((goal) => goal.id === requested);
  const updating = updatable && params.update === "1";

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex flex-col">
            <h1 className="text-lg font-bold text-ink">
              {t("common.checkIn")}
            </h1>
            <p className="text-xs text-ink-3">
              {due.length === 0
                ? t("checkIn.nothingOfYoursIsDue")
                : due.length === 1
                  ? t("checkIn.goalsDueOne", { count: due.length })
                  : t("checkIn.goalsDueOther", { count: due.length })}
            </p>
          </div>
          <Chip tone={due.length === 0 ? "ok" : "brand"}>
            {t("checkIn.due", { length: due.length })}
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
                      {t(
                        goal.hasOpenDraft
                          ? "checkIn.walkerLineDraftOpen"
                          : "checkIn.walkerLine",
                        {
                          level: goal.level,
                          keyResults:
                            goal.keyResultCount === 1
                              ? t("common.count.keyResultOne", {
                                  count: goal.keyResultCount,
                                })
                              : t("common.count.keyResultOther", {
                                  count: goal.keyResultCount,
                                }),
                          when:
                            goal.daysPastDue !== null && goal.daysPastDue > 0
                              ? t("checkIn.overdueBy", {
                                  days:
                                    goal.daysPastDue === 1
                                      ? t("common.count.dayOne", {
                                          count: goal.daysPastDue,
                                        })
                                      : t("common.count.dayOther", {
                                          count: goal.daysPastDue,
                                        }),
                                })
                              : t("checkIn.dueOn", {
                                  date: String(goal.nextCheckInOn),
                                }),
                          health: healthWord(t, goal.health),
                        },
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {/* No tone on the fill. Rule 2 of the colour system: progress is
                          not health, and a goal can be at 90 percent and still
                          be off track. The health word sits beside it instead. */}
                      <Bar
                        value={goal.progressPct}
                        max={ceiling}
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
        {later.length > 0 ? (
          <CardBody className="border-t border-line p-2">
            <section
              aria-labelledby="check-in-update-any-time"
              className="flex flex-col gap-1"
            >
              <h2
                id="check-in-update-any-time"
                className="px-2.5 pt-1 text-xs font-semibold text-ink-2"
              >
                {t("checkIn.updateAnyTime")}
              </h2>
              {later.map((goal) => (
                <a
                  key={goal.id}
                  href={`/check-in?goal=${goal.id}`}
                  aria-current={goal.id === requested ? "step" : undefined}
                  className={
                    goal.id === requested
                      ? "flex flex-col gap-0.5 rounded-md border border-brand-line bg-brand-weak p-2.5"
                      : "flex flex-col gap-0.5 rounded-md border border-transparent p-2.5 hover:bg-raised"
                  }
                >
                  <span className="text-sm text-ink">{goal.title}</span>
                  <span className="text-xs text-ink-3">
                    {t("checkIn.dueOn", { date: String(goal.nextCheckInOn) })}
                  </span>
                </a>
              ))}
            </section>
          </CardBody>
        ) : null}
      </Card>

      {requested ? (
        <CheckInForGoal
          context={context}
          goalId={requested}
          canEdit={canEdit}
          nextGoalId={nextGoalId}
          stillDue={stillDue || updating}
          updating={updating}
          updatable={updatable && !updating}
        />
      ) : due.length > 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-3">{t("checkIn.pickAGoalAbove")}</p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-3">{t("checkIn.nothingToDoHere")}</p>
          </CardBody>
        </Card>
      )}
    </div>
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
  updating,
  updatable,
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
  /** An extra update the reader asked to post on a goal not due yet. */
  readonly updating: boolean;
  /** The reader's own goal, not due yet, so an update can be offered. */
  readonly updatable: boolean;
}) {
  const { t } = await getTranslations();

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

  // Due by the goal's own date, not only by the reader's due list (UAT
  // BUG-012). \`stillDue\` asks whether the goal is in the reader's walker,
  // which only ever holds goals they champion, so anybody else opening a due
  // goal was told "This goal is not due" about a date that had passed.
  const dueHere = stillDue || (goal.daysPastDue ?? -1) >= 0;

  // The workspace's "Confidence shown as" (METHOD.md §12) and its §3.2
  // bands, read once for the composer, the votes and the timeline.
  const [rhythm, practiceRead] = await Promise.all([
    callAction(context, "rhythm.read", {}),
    callAction(context, "practice.read", {}),
  ]);
  const thresholds = rhythm.thresholds as ResolvedThresholds;
  const display = (practiceRead.practice as ResolvedPractice)[
    "confidence.display"
  ];

  // The people a blocker can be given to (H11): members only, because an
  // agent or an unclaimed placeholder cannot clear one (H-09).
  const owners =
    canEdit && (draft || updatable)
      ? (await callAction(context, "people.directory", {}))
          .filter(
            (member) => member.kind === "human" || member.kind === "guest",
          )
          .map((member) => ({ id: member.id, label: member.name }))
      : [];

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
          kind={goal.kind}
          thresholds={thresholds}
          display={display}
          keyResults={goal.keyResults}
          nextGoalId={updating ? null : nextGoalId}
          update={updating}
          goalId={goal.id}
        />
      ) : (
        <Card>
          <CardHeader className="justify-between">
            <h2 className="text-sm font-bold text-ink">{goal.title}</h2>
            <Chip tone={dueHere ? "neutral" : "ok"}>
              {dueHere ? t("checkIn.notYoursToReport") : t("checkIn.reported")}
            </Chip>
          </CardHeader>
          <CardBody className="flex flex-col gap-1.5">
            <p className="text-sm text-ink-3">
              {dueHere
                ? t("checkIn.youCanReadNotPost")
                : updatable && goal.nextCheckInOn
                  ? t("checkIn.notDueYetUpdate", { date: goal.nextCheckInOn })
                  : goal.nextCheckInOn
                    ? t("checkIn.notDueNextOn", { date: goal.nextCheckInOn })
                    : t("checkIn.notDueNotScheduled")}
            </p>
            {updatable && canEdit && !dueHere ? (
              <p>
                <a
                  className="inline-flex rounded-md border border-brand-line px-2.5 py-1 text-xs font-semibold text-brand-text hover:bg-brand-weak"
                  href={`/check-in?goal=${goal.id}&update=1`}
                >
                  {t("checkIn.postAnUpdate")}
                </a>
              </p>
            ) : null}
            {nextGoalId ? (
              <p className="text-xs text-ink-3">
                <a className="underline" href={`/check-in?goal=${nextGoalId}`}>
                  {t("checkIn.continueToYourNext")}
                </a>
              </p>
            ) : null}
          </CardBody>
        </Card>
      )}

      {owners.length > 0 ? (
        <RaiseBlocker
          keyResults={goal.keyResults.map((keyResult) => ({
            id: keyResult.id,
            label: keyResult.title,
          }))}
          owners={owners}
        />
      ) : null}

      <Votes votes={votes} canReveal={canEdit} display={display} />

      <Timeline
        checkIns={timeline.checkIns}
        canEdit={canEdit}
        display={display}
      />
    </>
  );
}
