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
import { callAction, excerptRichText } from "@openokr/core";
import {
  REVIEW_STAGE_KEYS,
  ROOT_CAUSES,
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
import { type Diagnostic, DiagnosticPanel } from "./diagnostic";
import { type Forward, ForwardPanel } from "./forward";
import { type ManagementRetro, ManagementRetroPanel } from "./management-retro";
import {
  type DecisionSubject,
  type MonthlyDecision,
  type MonthlyDependency,
  MonthlyReview,
  type MonthlyTrend,
  type MonthlyUntrended,
} from "./monthly-review";
import { type Narratives, NarrativesPanel } from "./narratives";
import { type ProcessHealth, ProcessHealthPanel } from "./process-health";
import { QuarterlyReview } from "./quarterly-review";
import { type Recognition, RecognitionPanel } from "./recognition";
import { type Reset, ResetPanel } from "./reset";
import { type RoomPulse, RoomPulsePanel } from "./room-pulse";
import { RootCausePanel, type RootCauses } from "./root-cause";
import { Scoring, type ScoringStatus } from "./scoring";
import { SessionLive } from "./session-live";
import { type TeamRetro, TeamRetroPanel } from "./team-retro";

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

  // Stage one's content (METHOD.md §8.2, P4-T10a-b). Read for the stage it
  // belongs to and not for the whole review: the other ten stages have their
  // own panels and their own tasks.
  let roomPulse: RoomPulse | null = null;
  if (isQuarterly && sessionRow.stageKey === REVIEW_STAGE_KEYS[0]) {
    roomPulse = (await callAction(context, "sessions.roomPulse", {
      sessionId: id,
    })) as RoomPulse;
  }

  // Stage two (METHOD.md §8.3, P4-T10b-a and P4-T10b-b).
  let scoring: ScoringStatus | null = null;
  if (isQuarterly && sessionRow.stageKey === REVIEW_STAGE_KEYS[1]) {
    scoring = (await callAction(context, "sessions.scoringStatus", {
      sessionId: id,
    })) as ScoringStatus;
  }
  // Stage three: the mic and the narratives (METHOD.md §8.1, P4-T10c).
  //
  // The stored body is turned into a plain-text excerpt here, on the server,
  // through the one shared rich text module. The panel is a client component and
  // handing it editor JSON would mean a second renderer in the browser for a
  // stage that shows two lines.
  let narratives: Narratives | null = null;
  if (isQuarterly && sessionRow.stageKey === REVIEW_STAGE_KEYS[2]) {
    const read = (await callAction(context, "sessions.narratives", {
      sessionId: id,
    })) as {
      micGoalId: string | null;
      objectives: {
        goalId: string;
        goalTitle: string;
        championName: string | null;
        hasMic: boolean;
        spokenAt: string | null;
        body: unknown;
        authorName: string | null;
      }[];
      spoken: number;
      total: number;
      complete: boolean;
    };
    narratives = {
      ...read,
      objectives: read.objectives.map((objective) => ({
        goalId: objective.goalId,
        goalTitle: objective.goalTitle,
        championName: objective.championName,
        hasMic: objective.hasMic,
        spokenAt: objective.spokenAt,
        excerpt:
          objective.body === null
            ? null
            : excerptRichText(objective.body as never, 2000) || null,
        authorName: objective.authorName,
      })),
    };
  }

  // Stage four: recognition (METHOD.md §8.1, P4-T10c).
  let recognition: Recognition | null = null;
  if (isQuarterly && sessionRow.stageKey === REVIEW_STAGE_KEYS[3]) {
    recognition = (await callAction(context, "sessions.recognition", {
      sessionId: id,
    })) as Recognition;
  }

  // Stage five: the team retro (METHOD.md §8.1, P4-T11a).
  let teamRetro: TeamRetro | null = null;
  if (isQuarterly && sessionRow.stageKey === REVIEW_STAGE_KEYS[4]) {
    teamRetro = (await callAction(context, "sessions.retro", {
      sessionId: id,
    })) as TeamRetro;
  }

  // Stage six: the management retro (METHOD.md §8.7, P4-T11a).
  //
  // **The refusal is caught rather than allowed to become an error page.**
  // `sessions.managementRetro` answers not-found to anybody who is not a manager
  // or the coordinator of this space, which is the audience rule working. An
  // ordinary member is not looking at a broken screen, so the page renders a
  // short line in its place instead: the stage is already named on the rail, and
  // saying whose it is discloses nothing that rail does not.
  let managementRetro: ManagementRetro | null = null;
  let managementWithheld = false;
  if (isQuarterly && sessionRow.stageKey === REVIEW_STAGE_KEYS[5]) {
    try {
      managementRetro = (await callAction(context, "sessions.managementRetro", {
        sessionId: id,
      })) as ManagementRetro;
    } catch {
      managementWithheld = true;
    }
  }

  // Stage seven: root causes (METHOD.md §8.4, P4-T11b).
  //
  // The taxonomy is added to the read here rather than imported by the panel,
  // because a client component holding its own copy of a canon list is the drift
  // §11 exists to prevent.
  let rootCauses: RootCauses | null = null;
  if (isQuarterly && sessionRow.stageKey === REVIEW_STAGE_KEYS[6]) {
    const read = (await callAction(context, "sessions.rootCauses", {
      sessionId: id,
    })) as Omit<RootCauses, "causes">;
    rootCauses = { ...read, causes: ROOT_CAUSES };
  }

  // Stage seven's second half: the diagnostic (METHOD.md §8.6, P4-T11c-a).
  //
  // Read on the same stage as the root causes, because §8.4 and §8.6 are one
  // stage in §8.1's agenda: name the causes, then read what they add up to.
  let diagnostic: Diagnostic | null = null;
  if (isQuarterly && sessionRow.stageKey === REVIEW_STAGE_KEYS[6]) {
    diagnostic = (await callAction(context, "sessions.diagnostic", {
      sessionId: id,
    })) as Diagnostic;
  }

  // Stage nine: keep, modify or abandon (METHOD.md §8.8, P4-T11c-a).
  let reset: Reset | null = null;
  if (isQuarterly && sessionRow.stageKey === REVIEW_STAGE_KEYS[8]) {
    reset = (await callAction(context, "sessions.reset", {
      sessionId: id,
    })) as Reset;
  }

  // Stages ten and eleven: learnings, drafts, decisions and actions
  // (METHOD.md §8.9 and §8.1 stage 11, P4-T11c-b).
  //
  // One read for both, because the two halves are one flow: what we learned,
  // what the next cycle might carry, and who does what by when.
  let forward: Forward | null = null;
  if (
    isQuarterly &&
    (sessionRow.stageKey === REVIEW_STAGE_KEYS[9] ||
      sessionRow.stageKey === REVIEW_STAGE_KEYS[10])
  ) {
    forward = (await callAction(context, "sessions.forward", {
      sessionId: id,
    })) as Forward;
  }

  // Stage eight: the process-health survey (METHOD.md §8.5, P4-T11b).
  let processHealth: ProcessHealth | null = null;
  if (isQuarterly && sessionRow.stageKey === REVIEW_STAGE_KEYS[7]) {
    processHealth = (await callAction(context, "sessions.processHealth", {
      sessionId: id,
    })) as ProcessHealth;
  }

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
          // Decided here because this is what renders the panels. A list of
          // built stages kept inside the rail component would be a second place
          // to forget when the next stage lands.
          stageHasPanel={
            roomPulse !== null ||
            scoring !== null ||
            narratives !== null ||
            recognition !== null ||
            teamRetro !== null ||
            managementRetro !== null ||
            managementWithheld ||
            rootCauses !== null ||
            processHealth !== null ||
            diagnostic !== null ||
            reset !== null ||
            forward !== null
          }
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

      {/* Stage one: the room pulse (METHOD.md §8.2, P4-T10a-b) */}
      {roomPulse ? (
        <RoomPulsePanel sessionId={id} pulse={roomPulse} canGive={isRunning} />
      ) : null}

      {/* Stage two: grading and revealing (METHOD.md §8.3, P4-T10b-a, P4-T10b-b) */}
      {scoring ? (
        <Scoring
          sessionId={id}
          status={scoring}
          canScore={isRunning}
          canReveal={isRunning && isFacilitator}
        />
      ) : null}

      {/* Stage three: objective narratives (METHOD.md §8.1, P4-T10c) */}
      {narratives ? (
        <NarrativesPanel
          sessionId={id}
          narratives={narratives}
          canWrite={isRunning}
          canPassMic={isRunning && isFacilitator}
        />
      ) : null}

      {/* Stage four: recognition and wins (METHOD.md §8.1, P4-T10c) */}
      {recognition ? (
        <RecognitionPanel
          sessionId={id}
          recognition={recognition}
          canGive={isRunning}
        />
      ) : null}

      {/* Stage five: the team retro (METHOD.md §8.1, P4-T11a) */}
      {teamRetro ? (
        <TeamRetroPanel
          sessionId={id}
          retro={teamRetro}
          canWrite={isRunning}
          canVote={isRunning}
        />
      ) : null}

      {/* Stage six: the management retro (METHOD.md §8.7, P4-T11a) */}
      {managementRetro ? (
        <ManagementRetroPanel
          sessionId={id}
          retro={managementRetro}
          canAnswer={isRunning}
        />
      ) : null}
      {managementWithheld ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-3">
              This stage is the four questions leadership answers. It is read by
              this space's managers and its coordinator.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {/* Stage seven: root causes (METHOD.md §8.4, P4-T11b) */}
      {rootCauses ? (
        <RootCausePanel
          sessionId={id}
          rootCauses={rootCauses}
          canName={isRunning}
        />
      ) : null}

      {/* Stage seven's second half: the diagnostic (METHOD.md §8.6, P4-T11c-a) */}
      {diagnostic ? (
        <DiagnosticPanel
          sessionId={id}
          diagnostic={diagnostic}
          canRead={isRunning}
        />
      ) : null}

      {/* Stage nine: keep, modify or abandon (METHOD.md §8.8, P4-T11c-a) */}
      {reset ? (
        <ResetPanel sessionId={id} reset={reset} canDecide={isRunning} />
      ) : null}

      {/* Stages ten and eleven (METHOD.md §8.9, §8.1 stage 11, P4-T11c-b) */}
      {forward ? (
        <ForwardPanel sessionId={id} forward={forward} canEdit={isRunning} />
      ) : null}

      {/* Stage eight: process health (METHOD.md §8.5, P4-T11b) */}
      {processHealth ? (
        <ProcessHealthPanel
          sessionId={id}
          health={processHealth}
          canAnswer={isRunning}
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
