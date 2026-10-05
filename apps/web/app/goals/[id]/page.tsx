import {
  ACCESS_LEVELS,
  ASSIST_FEATURE_KEYS,
  callAction,
  excerptRichText,
  OperationError,
  REVIEW_ASSIST_KEYS,
  THREAD_SUMMARY_MINIMUM,
} from "@openokr/core";
import type { ResolvedThresholds } from "@openokr/method";
import {
  Bar,
  Button,
  buttonVariants,
  Card,
  CardBody,
  CardHeader,
  Chip,
  formatMeasure,
} from "@openokr/ui";

import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveAccessLevelFor } from "../../../lib/access";
import { assistOffered } from "../../../lib/assists";
import { Attachments } from "../../../lib/attachments.tsx";
import { getPool } from "../../../lib/auth";
import { progressCeiling } from "../../../lib/ceilings.ts";
import { readConversation } from "../../../lib/conversation.ts";
import { FeedPanel } from "../../../lib/feed-panel.tsx";
import { readKpiOptions } from "../../../lib/kpi-options.ts";
import { SubjectComments } from "../../../lib/subject-comments.tsx";
import { getTranslations } from "../../../lib/translations";
import { WatchControl } from "../../../lib/watch-control.tsx";
import { requireWorkspace } from "../../../lib/workspace";
import { ActionForm } from "../../cycle/action-form.tsx";
import {
  readSubjectDocuments,
  SubjectDocuments,
} from "../../documents/subject-documents.tsx";
import { closeGoal, editGoal, reassignRole, reopenGoal } from "./actions.ts";
import { CoachStrip } from "./coach-strip";
import { DecomposeKeyResult } from "./decompose.tsx";
import { GoalWrites } from "./goal-writes.tsx";
import { AddKeyResult, KeyResultUpdate } from "./key-result-update.tsx";
import { Rail } from "./rail.tsx";
import { RetrospectiveField } from "./retrospective-field.tsx";
import { Sparkline } from "./sparkline.tsx";
import { ThreadSummary } from "./thread-summary.tsx";

/**
 * A goal (UIUX-PLAN.md §4 S-14, P3-T04).
 *
 * The lifecycle screen, not the full detail screen. Alignment, the check-in
 * timeline, the discussion and the sparkline all belong to S-14 proper and land
 * with the goal surfaces at P3-T10. What is here is what P3-T04 owns: the fields
 * that carry a rule, the two roles and the reassignment that rebinds access with
 * them, and the close and reopen transitions.
 *
 * Closing asks for three things at once because METHOD.md does: an outcome, a
 * keep/modify/abandon decision (§8.8) and an account of what happened (§4.3). A
 * form that let any of the three be skipped would let a cycle close with nothing
 * to feed the next one.
 */
export default async function GoalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** The feed's cursor, which is the only thing this page reads (P6-G11b). */
  searchParams: Promise<{ at?: string; id?: string }>;
}) {
  const { t } = await getTranslations();

  const { id } = await params;
  const { session, workspace } = await requireWorkspace();
  const context = {
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
    callAction(context, "activities.goalFeed", {
      goalId: id,
      ...(feedCursor ? { cursor: feedCursor } : {}),
    }),
    callAction(context, "people.directory", {}),
    callAction(context, "settings.readForMember", {}),
  ]);
  const feedNames = new Map(
    feedDirectory.map((member) => [member.id, member.name]),
  );

  // Whether this reader is watching this subject (P6-G07b). Read here rather
  // than in the control, because the control is a client component and the
  // answer is part of the page's own first paint.
  const watch = await callAction(context, "subscriptions.read", {
    subjectType: "goal",
    subjectId: id,
  });

  let goal: Awaited<ReturnType<typeof callAction<"goals.read">>>;
  try {
    goal = await callAction(context, "goals.read", { id });
  } catch (error) {
    // A goal somebody may not see is indistinguishable from one that does not
    // exist (§8.1 layer 2).
    if (error instanceof OperationError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;
  const canAdminister = level >= ACCESS_LEVELS.full;
  const members = canAdminister
    ? await callAction(context, "people.directory", {})
    : [];
  const closed = goal.closedAt !== null;

  /**
   * The decisions taken about this goal (METHOD.md §7.5, P4-T09).
   *
   * §7.5 calls the decision log "the artifact that survives the meeting", and
   * this page is where it survives to: a month after the review, nobody opens
   * the session again, they open the goal.
   */
  const decisions = (await callAction(context, "decisions.forGoal", {
    goalId: id,
  })) as Array<{
    id: string;
    text: string;
    at: string;
    authorName: string;
    keyResultTitle: string | null;
  }>;

  const relations = await callAction(context, "goals.relations", { id });

  // One history per key result. A goal carries a handful, so this is a handful
  // of small reads rather than a join that would return every value in the
  // workspace to draw four lines.
  const histories = new Map<
    string,
    readonly { readonly value: number; readonly at: string }[]
  >();
  // Whether the assist can offer anything, asked of the stored configuration
  // rather than assumed. With no provider the strip still shows every failing
  // rule and says the suggestion is what needs one.
  // One boolean rather than the provider table (P8-G05). This asked
  // `ai.readProviderConfig`, which is declared `full` because it carries every
  // provider's admin configuration and a masked key hint, so the whole screen
  // failed for any member who did not create the workspace.
  // The strength bands the coach strip colours its score by (H-17), and the
  // values a forecast waits for (§3.6, P9-T15a).
  const pageThresholds = (await callAction(context, "rhythm.read", {}))
    .thresholds as unknown as ResolvedThresholds;
  const strengthBands = pageThresholds["quality.strengthScoreBands"];
  const { available: drafting } = await callAction(
    context,
    "ai.readAvailability",
    {},
  );

  for (const keyResult of goal.keyResults) {
    const history = await callAction(context, "goals.keyResultHistory", {
      keyResultId: keyResult.id,
      limit: 100,
    });
    histories.set(keyResult.id, history.values);
  }
  // The instant the forecast projects to. The scoring recompute prefers the
  // cycle end and falls back to the key result's own due date, so this reads the
  // same way: a chart projecting to a different horizon than the stored forecast
  // would be two answers to one question.
  // The discussion (P3-T16). Read here rather than inside the client component
  // so the thread server-renders with the page, the way every other read on
  // this page does.
  // Documents on this goal. The query has already dropped anybody else's
  // draft, so this list is safe to render as it comes (P5-T12).
  const documents = await readSubjectDocuments(context, "goal", id);

  const conversation = await readConversation(context, "goal", id);

  // The files on this goal (completeness review M-01). `attachments.attach`
  // took a goal from the start; the panel was only ever mounted elsewhere.
  const attachments = await callAction(context, "attachments.list", {
    subjectType: "goal",
    subjectId: id,
  });

  // Key results measured by hand, which the writes card can link to a KPI
  // (M-07). Offered on the same terms as the value form: an editor, on a goal
  // that is still open. The KPI list is read only when there is something to
  // link, so a goal page with nothing to offer pays nothing for it.
  const unlinkedKeyResults =
    canEdit && !closed
      ? goal.keyResults
          .filter((keyResult) => keyResult.kpiId === null)
          .map((keyResult) => ({ id: keyResult.id, title: keyResult.title }))
      : [];
  const kpiOptions =
    unlinkedKeyResults.length > 0 ? await readKpiOptions(context) : [];

  // The assists this page can offer (completeness review M-09), each asked
  // whether a provider may run it here and each only where it has something
  // to work on. With AI off all three are false and the page is what it was.
  // The draft retrospective and the decomposition are for somebody who may
  // change this goal; the thread summary is for anybody who may read it.
  const open = canEdit && !closed;
  const [retrospectiveOffered, threadSummaryOffered, decomposeOffered] =
    await Promise.all([
      open
        ? assistOffered(
            workspace.workspaceId,
            REVIEW_ASSIST_KEYS.draftRetrospective,
            "balanced",
            session.user.id,
          )
        : false,
      conversation.comments.length >= THREAD_SUMMARY_MINIMUM
        ? assistOffered(
            workspace.workspaceId,
            ASSIST_FEATURE_KEYS.summariseThread,
            "balanced",
            session.user.id,
          )
        : false,
      open && goal.keyResults.length > 0
        ? assistOffered(
            workspace.workspaceId,
            ASSIST_FEATURE_KEYS.decomposeKeyResult,
            "deep",
            session.user.id,
          )
        : false,
    ]);
  const workSpaces = decomposeOffered
    ? (await callAction(context, "spaces.list", {})).map((space) => ({
        id: space.id,
        name: space.name,
      }))
    : [];

  // What the last check-in said, which a confidence changed here carries
  // forward as its status unless the reader changes it (P9-T08b).
  const lastStatus = open
    ? ((
        await callAction(context, "goals.checkIns", {
          goalId: id,
          includeDrafts: false,
        })
      ).checkIns[0]?.status ?? null)
    : null;

  const cycles = await callAction(context, "cycles.list", {});
  const cycleEndsOn =
    cycles.find((cycle) => cycle.id === goal.cycleId)?.endsOn ?? null;
  const horizonFor = (dueOn: string | null): number | null => {
    const date = cycleEndsOn ?? dueOn;
    return date ? new Date(`${date}T00:00:00Z`).getTime() : null;
  };

  return (
    <div className="flex w-full flex-col gap-4.5 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">{goal.title}</h1>
              <p className="text-xs text-ink-3">
                {goal.reviewer
                  ? t("common.championsItReviewsItWeight", {
                      level: goal.level,
                      name: goal.champion.name,
                      name2: goal.reviewer.name,
                      weight: goal.weight,
                    })
                  : t("common.championsItNoReviewerWeight", {
                      level: goal.level,
                      name: goal.champion.name,
                      weight: goal.weight,
                    })}
              </p>
            </div>
            <Chip tone={closed ? "neutral" : "brand"}>
              {closed
                ? t("goals.detail.closedStatus", {
                    status: String(goal.successStatus),
                  })
                : goal.health.replace("_", " ")}
            </Chip>
            <WatchControl subjectType="goal" subjectId={id} initial={watch} />
            {/* Check in's door on the goal itself, now that it has left the
             * sidebar (P9-T07a-b, okr-entry-points.md §3.1). */}
            {open ? (
              <Link
                href={`/check-in?goal=${id}`}
                className={buttonVariants({ size: "sm" })}
              >
                {t("common.checkIn")}
              </Link>
            ) : null}
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Bar
                value={goal.progressPct}
                max={await progressCeiling()}
                className="h-1.5 flex-1"
              />
              <span className="text-xs font-semibold text-ink-3">
                {Math.round(goal.progressPct)}%
              </span>
            </div>
            {goal.nextCheckInOn ? (
              <p className="text-xs text-ink-3">
                {goal.daysPastDue !== null && goal.daysPastDue > 0
                  ? t("goals.detail.nextCheckInDueOverdue", {
                      date: goal.nextCheckInOn,
                      days:
                        goal.daysPastDue === 1
                          ? t("common.count.dayOne", {
                              count: goal.daysPastDue,
                            })
                          : t("common.count.dayOther", {
                              count: goal.daysPastDue,
                            }),
                    })
                  : t("goals.detail.nextCheckInDueOn", {
                      date: goal.nextCheckInOn,
                    })}
              </p>
            ) : (
              <p className="text-xs text-ink-3">
                {t("goals.detail.noCheckInIs")}
              </p>
            )}
            <p className="text-xs text-ink-3">
              {goal.contributionStatement ??
                t("goals.detail.noParentNoContribution")}
            </p>
            {goal.progressPct === 0 ? (
              <p className="text-xs text-ink-4">
                {t("goals.detail.nothingHasMovedYet")}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <CoachStrip
          goalId={goal.id}
          score={goal.quality.score}
          flags={goal.quality.flags}
          keyResults={goal.keyResults.map((kr) => ({
            id: kr.id,
            title: kr.title,
            qualityFlags: kr.qualityFlags,
          }))}
          drafting={drafting}
          canEdit={canEdit && !closed}
          bands={strengthBands}
        />

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("goals.detail.keyResults", {
                length: goal.keyResults.length,
              })}
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-2.5">
            {goal.keyResults.length === 0 ? (
              <p className="text-sm text-ink-3">
                {t("goals.detail.noneYetWithoutOne")}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {goal.keyResults.map((keyResult) => (
                  <li
                    key={keyResult.id}
                    // The quality panel links straight at the key result a
                    // check named, so an issue found in the panel lands on the
                    // row that fixes it rather than at the top of the page.
                    id={`kr-${keyResult.id}`}
                    className="flex items-start justify-between gap-2.5 py-2.5 first:pt-0 last:pb-0 target:rounded-md target:bg-brand-weak"
                  >
                    {/* `gap-1` rather than nothing: the three children stack
                        tight without it, and the sparkline's own box then sits
                        hard against the line of metadata above it, which reads
                        as the chart overlapping the row. */}
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm text-ink">
                        {keyResult.title}
                      </span>
                      <span className="text-xs text-ink-3">
                        {t("common.toWeight2", {
                          direction: keyResult.direction,
                          indicatorType: keyResult.indicatorType,
                          baselineValue: formatMeasure(keyResult.baselineValue),
                          targetValue:
                            keyResult.targetValue === null
                              ? t("common.noTargetYet")
                              : formatMeasure(keyResult.targetValue),
                          unit: keyResult.unit ? ` ${keyResult.unit}` : "",
                          weight: keyResult.weight,
                        })}
                      </span>
                      <Sparkline
                        history={histories.get(keyResult.id) ?? []}
                        direction={keyResult.direction}
                        baseline={keyResult.baselineValue}
                        // Only a metric is projected (§3.6, P9-T15a).
                        target={
                          keyResult.kind === "metric"
                            ? keyResult.targetValue
                            : null
                        }
                        horizonAt={horizonFor(keyResult.dueOn)}
                        minimumValues={
                          pageThresholds["scoring.forecastMinimumValues"]
                        }
                      />
                      {decomposeOffered ? (
                        <DecomposeKeyResult
                          goalId={goal.id}
                          keyResultId={keyResult.id}
                          keyResultTitle={keyResult.title}
                          spaces={workSpaces}
                          defaultSpaceId={goal.spaceId}
                        />
                      ) : null}
                    </span>
                    <span className="flex flex-none flex-col items-end gap-1">
                      <span className="text-sm font-bold text-ink">
                        {formatMeasure(keyResult.currentValue, keyResult.unit)}
                      </span>
                      {/* The work behind this measure, as a board (M-02): the
                          tasks that name it and its initiatives' tasks. */}
                      <Link
                        href={`/board?keyResult=${keyResult.id}`}
                        aria-label={t("goals.detail.workBoardFor", {
                          title: keyResult.title,
                        })}
                        className="text-xs font-semibold text-brand-text hover:underline"
                      >
                        {t("goals.detail.workBoard")}
                      </Link>
                      {open && keyResult.kpiId === null ? (
                        <KeyResultUpdate
                          goalId={goal.id}
                          keyResult={{
                            id: keyResult.id,
                            title: keyResult.title,
                            currentValue: keyResult.currentValue,
                            confidence: keyResult.confidence,
                          }}
                          lastStatus={lastStatus}
                        />
                      ) : keyResult.kpiId ? (
                        <Chip tone="info">{t("common.fromAKpi")}</Chip>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {/* S-14's "+ Add key result" (P9-T08b), owned by the champion and
             * due at the cycle's end, as a row added from the list is. */}
            {open ? (
              <AddKeyResult
                goalId={goal.id}
                ownerId={goal.champion.id}
                dueOn={cycleEndsOn}
              />
            ) : null}
          </CardBody>
        </Card>

        {canEdit && !closed ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">{t("common.edit")}</h2>
            </CardHeader>
            <CardBody>
              <ActionForm action={editGoal} className="flex flex-col gap-1.5">
                <input type="hidden" name="id" value={goal.id} />
                <label className="sr-only" htmlFor="edit-title">
                  {t("common.theObjective")}
                </label>
                <input
                  id="edit-title"
                  name="title"
                  required
                  maxLength={500}
                  defaultValue={goal.title}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                />
                <label className="sr-only" htmlFor="edit-contribution">
                  {t("common.whatItContributesTo")}
                </label>
                <input
                  id="edit-contribution"
                  name="contributionStatement"
                  maxLength={1000}
                  defaultValue={goal.contributionStatement ?? ""}
                  placeholder={t("common.thePriorityThisMoves")}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
                />
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-ink-3" htmlFor="edit-weight">
                    {t("goals.detail.weight")}
                  </label>
                  <input
                    id="edit-weight"
                    name="weight"
                    type="number"
                    step="any"
                    min={0}
                    max={100}
                    defaultValue={goal.weight}
                    className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink"
                  />
                  <span className="text-xs text-ink-4">
                    {t("goals.detail.0MeansTrackedBut")}
                  </span>
                  <Button type="submit" className="ml-auto">
                    {t("common.save")}
                  </Button>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}

        {canAdminister ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                {t("common.roles")}
              </h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-2.5">
              <p className="text-xs text-ink-3">
                {t("goals.detail.bothRolesAreAccess")}
              </p>
              <ActionForm
                action={reassignRole}
                className="flex flex-wrap items-center gap-1.5"
              >
                <input type="hidden" name="id" value={goal.id} />
                <label className="sr-only" htmlFor="reassign-role">
                  {t("goals.detail.role")}
                </label>
                <select
                  id="reassign-role"
                  name="role"
                  defaultValue="champion"
                  className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                >
                  <option value="champion">{t("common.champion")}</option>
                  <option value="reviewer">{t("common.reviewer")}</option>
                </select>
                <label className="sr-only" htmlFor="reassign-member">
                  {t("goals.detail.member")}
                </label>
                <select
                  id="reassign-member"
                  name="memberId"
                  className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                  {/* Takes the reviewer off (P9-T04). Refused for the
                   * champion, who is always somebody, and where the
                   * workspace requires reviewers, each with the reason. */}
                  <option value="">
                    {t("goals.detail.nobodyReviewerOnly")}
                  </option>
                </select>
                <Button type="submit" variant="ghost">
                  {t("common.reassign")}
                </Button>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}

        {decisions.length === 0 ? null : (
          // Named, so it is a landmark a screen reader can jump to and a
          // test can scope to. A card with no accessible name is a div.
          <Card role="region" aria-labelledby="goal-decisions-heading">
            <CardHeader>
              <h2
                id="goal-decisions-heading"
                className="text-sm font-bold text-ink"
              >
                {t("common.decisions")}
              </h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-2">
              <ul className="flex flex-col gap-2">
                {decisions.map((decision) => (
                  <li
                    key={decision.id}
                    className="flex flex-col gap-1 rounded-md border border-line p-2.5"
                  >
                    <span className="text-sm text-ink">{decision.text}</span>
                    {/* The criterion names the date and the author, and the
                        key result when one was named, because a decision
                        about one number is not a decision about the goal. */}
                    <span className="text-xs text-ink-3">
                      {decision.keyResultTitle
                        ? `${decision.keyResultTitle} · `
                        : ""}
                      {new Date(decision.at).toLocaleDateString()} ·{" "}
                      {decision.authorName}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink-4">
                {t("goals.detail.recordedInAMonthly")}
              </p>
            </CardBody>
          </Card>
        )}

        {goal.retrospective ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                {t("goals.detail.retrospective")}
              </h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-1.5">
              <p className="text-sm text-ink-2">
                {excerptRichText(goal.retrospective.body as never, 2000) ||
                  t("goals.detail.writtenButEmpty")}
              </p>
              <p className="text-xs text-ink-4">
                {t("goals.detail.keptWhetherTheGoal")}
              </p>
            </CardBody>
          </Card>
        ) : null}

        {canEdit ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                {closed ? t("goals.detail.reopen") : t("shell.shortcuts.close")}
              </h2>
            </CardHeader>
            <CardBody>
              {closed ? (
                <ActionForm
                  action={reopenGoal}
                  className="flex flex-col gap-1.5"
                >
                  <input type="hidden" name="id" value={goal.id} />
                  <p className="text-sm text-ink-3">
                    {t("goals.detail.reopeningClearsTheOutcome")}
                  </p>
                  <Button type="submit" variant="ghost" className="self-start">
                    {t("goals.detail.reopenThisGoal")}
                  </Button>
                </ActionForm>
              ) : (
                <ActionForm
                  action={closeGoal}
                  className="flex flex-col gap-1.5"
                >
                  <input type="hidden" name="id" value={goal.id} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <label className="sr-only" htmlFor="close-outcome">
                      {t("goals.detail.outcome")}
                    </label>
                    <select
                      id="close-outcome"
                      name="successStatus"
                      defaultValue="achieved"
                      className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                    >
                      <option value="achieved">
                        {t("goals.detail.achieved")}
                      </option>
                      <option value="missed">{t("goals.detail.missed")}</option>
                    </select>
                    <label className="sr-only" htmlFor="close-decision">
                      {t("goals.detail.decision")}
                    </label>
                    <select
                      id="close-decision"
                      name="closeDecision"
                      defaultValue="keep"
                      className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                    >
                      <option value="keep">{t("goals.detail.keep")}</option>
                      <option value="modify">{t("goals.detail.modify")}</option>
                      <option value="abandon">
                        {t("goals.detail.abandon")}
                      </option>
                    </select>
                    <input
                      name="closeReason"
                      maxLength={2000}
                      placeholder={t("goals.detail.whyThatDecision")}
                      aria-label={t("goals.detail.whyThatDecision")}
                      className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
                    />
                  </div>
                  <RetrospectiveField
                    goalId={goal.id}
                    offered={retrospectiveOffered}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    className="self-start"
                  >
                    {t("goals.detail.closeThisGoal")}
                  </Button>
                </ActionForm>
              )}
            </CardBody>
          </Card>
        ) : null}

        <SubjectDocuments
          subjectType="goal"
          subjectId={id}
          documents={documents}
          canEdit={canEdit}
        />

        <Attachments
          subjectType="goal"
          subjectId={id}
          attachments={attachments}
          canEdit={canEdit}
        />

        <Card>
          <CardBody className="flex flex-col gap-3">
            {threadSummaryOffered ? <ThreadSummary goalId={id} /> : null}
            <SubjectComments
              subjectType="goal"
              subjectId={id}
              comments={conversation.comments}
              reactions={conversation.reactions}
              currentMemberId={workspace.memberId}
            />
          </CardBody>
        </Card>

        {/*
         * The writes P6-G27 gave a browser path. Last in the column, because
         * moving or deleting a goal is the end of a conversation rather than
         * part of one.
         */}
        <GoalWrites
          goalId={id}
          cycles={cycles.map((cycle) => ({ id: cycle.id, name: cycle.name }))}
          currentCycleId={goal.cycleId ?? null}
          linkedKeyResults={goal.keyResults
            .filter((keyResult) => keyResult.kpiId !== null)
            .map((keyResult) => ({
              id: keyResult.id,
              title: keyResult.title,
            }))}
          unlinkedKeyResults={unlinkedKeyResults}
          kpis={kpiOptions}
          canAdminister={canAdminister}
        />

        {/*
         * **Inside the content column, not beside it.** P6-G11b put this
         * panel where the closing tags made it look like a sibling of the
         * rail, and the row above is `lg:flex-row` with exactly two
         * children by design: a content column that is `min-w-0 flex-1`
         * and a rail that is `lg:w-80`. A third child takes its intrinsic
         * width, and `min-w-0` lets the content column give up every pixel
         * of it, so the objective's own heading collapsed towards zero
         * width. Continuous integration caught it as an end-to-end failure
         * reading "hidden" on a heading the screenshot plainly showed,
         * because an element with an empty box is hidden.
         */}
        <FeedPanel
          title={t("common.activity")}
          explains={t("goals.detail.feedExplains")}
          items={feedItems}
          names={feedNames}
          timeZone={String(feedSettings.settings.timezone ?? "UTC")}
          basePath={`/goals/${id}`}
          paged={feedCursor !== undefined}
          live={{ scope: "goal", subjectId: id }}
        />
      </div>

      <aside className="w-full flex-none lg:w-80">
        <Rail relations={relations} level={goal.level} />
      </aside>
    </div>
  );
}
