/**
 * Session screen: space home before the session, and the running session
 * step rail (UIUX-PLAN.md S-22, METHOD.md §7.2, P4-T07a).
 *
 * Two states rendered from the same server component:
 *
 * - **Before**: shows the next scheduled session with Open and Skip controls,
 *   and the step rail in a disabled preview state.
 * - **Running**: shows the current stage highlighted, the elapsed timer, the
 *   continue control, and the participant list.
 *
 * Live synchronisation: `SessionLive` (a thin client component) subscribes to
 * the SSE endpoint and calls `router.refresh()` on every `session.stageChanged`
 * event. This satisfies the acceptance criterion: both participants see the
 * stage advance without a manual reload.
 *
 * What is deliberately absent: the twelve-week confidence trend (P4-T07b data),
 * the streak ribbon (P4-T08), and the blocker ages (P4-T07c table). Those are
 * listed as "no data yet" placeholders rather than faked. P4-T07a owns the
 * session record and the live sync; the subsequent tasks fill the panels.
 */
import { callAction } from "@openokr/core";
import {
  REVIEW_STAGE_KEYS,
  reviewStages,
  WEEKLY_STAGE_KEYS,
  WEEKLY_STEPS,
  type WeeklyStep,
} from "@openokr/method";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { notFound } from "next/navigation";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import {
  advanceStageAction,
  closeSessionAction,
  openSessionAction,
  skipSessionAction,
} from "./actions";
import { ConfidenceRound } from "./confidence-round";
import {
  type DecisionSubject,
  type MonthlyDecision,
  type MonthlyDependency,
  MonthlyReview,
  type MonthlyTrend,
  type MonthlyUntrended,
} from "./monthly-review";
import { QuarterlyReview } from "./quarterly-review";
import { SessionLive } from "./session-live";

interface SessionPageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: SessionPageProps) {
  const { id } = await params;
  const { session, workspace } = await requireWorkspace();
  const pool = getPool();
  const context = {
    pool,
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  let sessionRow: {
    id: string;
    kind: string;
    title: string;
    state: string;
    stageKey: string | null;
    stageStartedAt: string | null;
    facilitatorId: string;
    scheduledFor: string;
    elapsed: Record<string, number>;
    addedMinutes: Record<string, number>;
    notes: Record<string, unknown>;
  };

  try {
    sessionRow = (await callAction(context, "sessions.read", {
      id,
    })) as typeof sessionRow;
  } catch {
    notFound();
  }

  const participants = (await callAction(context, "sessions.participants", {
    id,
  })) as Array<{ memberId: string; name: string }>;

  // Load confidence status for the confidence round (P4-T07b).
  let krStatuses: Array<{
    keyResultId: string;
    title: string;
    confirmed: boolean;
    confirmedConfidence: number | null;
    whatChanged: string | null;
  }> = [];
  if (sessionRow.stageKey === "confidence") {
    try {
      krStatuses = (await callAction(context, "sessions.confidenceStatus", {
        sessionId: id,
      })) as typeof krStatuses;
    } catch {
      // No KRs in this space's cycle, or action not available.
    }
  }

  const isFacilitator = workspace.memberId === sessionRow.facilitatorId;
  const isScheduled = sessionRow.state === "scheduled";
  const isRunning = sessionRow.state === "running";
  const isMonthly = sessionRow.kind === "monthly";
  const isQuarterly = sessionRow.kind === "quarterly";

  // §8.1's eleven stages with the durations §11 gives this workspace, so a
  // workspace that tuned its agenda is paced by its own numbers.
  const reviewAgenda = isQuarterly
    ? reviewStages(
        (await callAction(context, "rhythm.read", {}))
          .thresholds as unknown as Parameters<typeof reviewStages>[0],
      )
    : [];

  // The monthly review's whole record in one read (METHOD.md §7.5, P4-T09).
  // Loaded for a scheduled session as well, so a facilitator can see what the
  // room will be looking at before they open it.
  interface MonthlyRecord {
    shifts: string | null;
    trends: MonthlyTrend[];
    untrended: MonthlyUntrended[];
    dependencies: MonthlyDependency[];
    decisions: MonthlyDecision[];
  }
  let monthly: MonthlyRecord | null = null;
  const decisionSubjects: DecisionSubject[] = [];
  if (isMonthly) {
    monthly = (await callAction(context, "sessions.monthlyRecord", {
      sessionId: id,
    })) as MonthlyRecord;

    // §7.5 attaches a decision to a key result first and an objective second,
    // so both are offered and the key results are listed under the objective
    // they belong to.
    const objectives = [
      ...monthly.trends.map((entry) => ({
        goalId: entry.goalId,
        goalTitle: entry.goalTitle,
      })),
      ...monthly.untrended,
    ];
    for (const objective of objectives) {
      decisionSubjects.push({
        kind: "goal",
        id: objective.goalId,
        label: objective.goalTitle,
      });
      const goal = (await callAction(context, "goals.read", {
        id: objective.goalId,
      })) as { keyResults: Array<{ id: string; title: string }> };
      for (const keyResult of goal.keyResults) {
        decisionSubjects.push({
          kind: "keyResult",
          id: keyResult.id,
          label: `${objective.goalTitle} · ${keyResult.title}`,
        });
      }
    }
  }
  /**
   * The stage list this ritual walks, or empty when it has none (P4-T10a-a).
   *
   * The same shape the action uses. This read WEEKLY_STAGE_KEYS outright, so a
   * quarterly review's stage was never found in it: the index stayed at -1 and
   * the facilitator was offered "Continue to next step" on stage eleven, where
   * advancing throws. A monthly review has no stages at all and gets neither
   * control.
   */
  const stageKeys: readonly string[] =
    sessionRow.kind === "weekly"
      ? WEEKLY_STAGE_KEYS
      : isQuarterly
        ? REVIEW_STAGE_KEYS
        : [];
  const currentStageIndex = sessionRow.stageKey
    ? stageKeys.indexOf(sessionRow.stageKey)
    : -1;
  const isOnLastStage =
    stageKeys.length > 0 && currentStageIndex === stageKeys.length - 1;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Live sync: subscribes to SSE and calls router.refresh() on stage changes */}
      {isRunning && <SessionLive sessionId={id} />}

      {/* Session header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">{sessionRow.title}</h1>
          <p className="text-sm text-ink-2">
            {new Date(sessionRow.scheduledFor).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <Chip tone="neutral">{sessionRow.kind}</Chip>
      </div>

      {/* State-specific controls (facilitator only) */}
      {isFacilitator && isScheduled && (
        <div className="flex gap-3">
          <form
            action={async () => {
              "use server";
              await openSessionAction(id);
            }}
          >
            <Button type="submit" variant="primary">
              Start session
            </Button>
          </form>
          <form
            action={async () => {
              "use server";
              await skipSessionAction(id);
            }}
          >
            <Button type="submit" variant="default">
              Skip
            </Button>
          </form>
        </div>
      )}

      {/* Step rail */}
      {sessionRow.kind === "weekly" && (
        <Card>
          <CardHeader>Steps</CardHeader>
          <CardBody>
            <ol className="space-y-3">
              {WEEKLY_STEPS.map((step: WeeklyStep, index: number) => {
                const stageKey = WEEKLY_STAGE_KEYS[index];
                const isCurrent = stageKey === sessionRow.stageKey;
                const isComplete = currentStageIndex > index;

                return (
                  <li
                    key={step.step}
                    className={[
                      "flex items-start gap-3 rounded-md p-3",
                      isCurrent ? "bg-brand/10 ring-1 ring-brand" : "",
                      isComplete ? "opacity-50" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span
                      className={[
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                        isCurrent
                          ? "bg-brand text-white"
                          : isComplete
                            ? "bg-line text-ink-3"
                            : "bg-surface text-ink-2",
                      ].join(" ")}
                    >
                      {step.step}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {step.title}
                      </p>
                      <p className="text-xs text-ink-2">{step.purpose}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>
      )}

      {/* P4-T07b: Confidence round panel */}
      {isRunning && sessionRow.stageKey === "confidence" && (
        <ConfidenceRound
          sessionId={id}
          krStatuses={krStatuses}
          isFacilitator={isFacilitator}
        />
      )}

      {/* Continue / close controls for the facilitator during a running session */}
      {isFacilitator && isRunning && (
        <div className="flex gap-3">
          {!isOnLastStage && !isMonthly ? (
            <form
              action={async () => {
                "use server";
                await advanceStageAction(id);
              }}
            >
              <Button type="submit" variant="primary">
                Continue to next step
              </Button>
            </form>
          ) : (
            <form
              action={async () => {
                "use server";
                await closeSessionAction(id);
              }}
            >
              <Button type="submit" variant="primary">
                Close session
              </Button>
            </form>
          )}
        </div>
      )}

      {/* The quarterly review's shell (METHOD.md §8.1, S-24, P4-T10a-a) */}
      {isQuarterly ? (
        <QuarterlyReview
          sessionId={id}
          stages={reviewAgenda}
          stageKeys={REVIEW_STAGE_KEYS}
          currentStageKey={sessionRow.stageKey}
          stageStartedAt={sessionRow.stageStartedAt}
          elapsed={sessionRow.elapsed}
          addedMinutes={sessionRow.addedMinutes}
          // Empty for everybody but the facilitator: `sessions.read` refuses to
          // hand the notes over, so this is not the screen deciding.
          note={
            typeof sessionRow.notes[sessionRow.stageKey ?? ""] === "string"
              ? (sessionRow.notes[sessionRow.stageKey ?? ""] as string)
              : ""
          }
          isFacilitator={isFacilitator}
          isRunning={isRunning}
        />
      ) : null}

      {/* The monthly review's record (METHOD.md §7.5, S-23, P4-T09) */}
      {monthly ? (
        <MonthlyReview
          sessionId={id}
          shifts={monthly.shifts}
          trends={monthly.trends}
          untrended={monthly.untrended}
          dependencies={monthly.dependencies}
          decisions={monthly.decisions}
          subjects={decisionSubjects}
          canEdit={isRunning}
        />
      ) : null}

      {/* Participant list */}
      {participants.length > 0 && (
        <Card>
          <CardHeader>Participants</CardHeader>
          <CardBody>
            <ul className="space-y-1">
              {participants.map((p) => (
                <li key={p.memberId} className="text-sm text-ink">
                  {p.name}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Placeholders for data that arrives with later tasks */}
      {isRunning && !isMonthly && !isQuarterly && (
        <p className="text-xs text-ink-3">
          Confidence trend (P4-T07b), blockers (P4-T07c) and streak (P4-T08)
          appear once their tables exist.
        </p>
      )}
    </div>
  );
}
