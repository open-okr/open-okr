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

  const isFacilitator = workspace.memberId === sessionRow.facilitatorId;
  const isScheduled = sessionRow.state === "scheduled";
  const isRunning = sessionRow.state === "running";
  const currentStageIndex = sessionRow.stageKey
    ? WEEKLY_STAGE_KEYS.indexOf(
        sessionRow.stageKey as (typeof WEEKLY_STAGE_KEYS)[number],
      )
    : -1;
  const isOnLastStage = currentStageIndex === WEEKLY_STAGE_KEYS.length - 1;

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

      {/* Continue / close controls for the facilitator during a running session */}
      {isFacilitator && isRunning && (
        <div className="flex gap-3">
          {!isOnLastStage ? (
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
      {isRunning && (
        <p className="text-xs text-ink-3">
          Confidence trend (P4-T07b), blockers (P4-T07c) and streak (P4-T08)
          appear once their tables exist.
        </p>
      )}
    </div>
  );
}
