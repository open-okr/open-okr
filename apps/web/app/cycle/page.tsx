import { ACCESS_LEVELS, callAction } from "@openokr/core";
import {
  canonThresholds,
  KEY_RESULT_CHECKS,
  OBJECTIVE_CHECKS,
  PHASE_TITLES,
  phaseWorkAllowed,
  type ResolvedThresholds,
} from "@openokr/method";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../lib/access";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { assistsAvailableAction } from "./assist-actions.ts";
import { Diagnose } from "./diagnose.tsx";
import { Direction } from "./direction.tsx";
import { Drafting } from "./drafting.tsx";
import { Gates } from "./gates.tsx";
import { GuidanceRail } from "./guidance-rail.tsx";
import { InputPack } from "./input-pack.tsx";
import { PhaseRail } from "./phase-rail.tsx";
import { QualityPanel } from "./quality-panel.tsx";

/**
 * The cycle workspace (UIUX-PLAN.md §4 S-04, S-06 to S-08, P3-T03).
 *
 * Three regions, as §4 describes them: the eight phases down the left, the
 * selected phase's work in the centre, and the facilitator's guidance on the
 * right. The phase in the query string is what the reader is looking at; the
 * cycle's own `phase` column is where the facilitator says the work is. Those are
 * different facts and the screen keeps them apart.
 *
 * Nothing here decides whether a phase is done. Every mark, blocker and gate
 * comes from `workflow.read`, which computes them from rows through
 * `packages/method`. METHOD.md §2.3: the product computes this, it is not
 * self-reported.
 *
 * The phases whose surfaces need goals and key results (4, 6 and 7) say what they
 * are waiting for rather than pretending to be empty.
 */

export default async function CyclePage({
  searchParams,
}: {
  searchParams: Promise<{ phase?: string }>;
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
  const canPublish = level >= ACCESS_LEVELS.full;

  // The cycle containing today, else the soonest ahead. A workspace always has
  // one: provisioning creates it, because a planning tool with no time box to
  // plan in is not usable (P3-T02).
  const cycle = await callAction(context, "cycles.current", {
    mode: "quarterly",
  });

  if (!cycle) {
    return (
      <AppShellLayout>
        <div className="mx-auto flex max-w-xl flex-col gap-4.5">
          <Card>
            <CardHeader>
              <h1 className="text-lg font-bold text-ink">No cycle yet</h1>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-ink-3">
                This workspace has no cycle to plan. An administrator can create
                one from the rhythm settings.
              </p>
            </CardBody>
          </Card>
        </div>
      </AppShellLayout>
    );
  }

  const workflow = await callAction(context, "workflow.read", {
    cycleId: cycle.id,
  });

  /**
   * The decision log for this cycle (METHOD.md §7.5, P4-T09).
   *
   * §7.5 surfaces the log in two places, and this is the second: the goal page
   * answers "what was decided about this", the cycle workspace answers "what
   * has this cycle decided". Read on every phase rather than only during the
   * running one, because a decision taken in month two is still the reason
   * something looks the way it does at the close.
   */
  const cycleDecisions = (await callAction(context, "decisions.forCycle", {
    cycleId: cycle.id,
  })) as Array<{
    id: string;
    text: string;
    at: string;
    authorName: string;
    goalId: string | null;
    goalTitle: string | null;
    keyResultTitle: string | null;
  }>;

  const requested = Number((await searchParams).phase ?? Number.NaN);
  const viewing =
    Number.isInteger(requested) && requested >= 0 && requested <= 7
      ? requested
      : workflow.phase;

  const phase = workflow.phases[viewing];
  const work = phaseWorkAllowed(viewing, workflow.phases);

  // Only phase 4 needs the set and the member list, and only phase 4 pays for
  // reading them.
  const draft =
    viewing === 4
      ? {
          goals: (
            await callAction(context, "goals.list", {
              cycleId: workflow.cycleId,
              includeClosed: false,
            })
          ).goals,
          members: (await callAction(context, "people.directory", {})).map(
            (member) => ({ id: member.id, name: member.name }),
          ),
          // The coach runs in the browser and cannot read the settings row, so
          // the resolved thresholds travel with the page. Sending them rather
          // than letting the client fall back to the canon is what keeps a
          // workspace that has tuned its bounds judged by its own numbers.
          // `rhythm.read` types this as an unknown record because the registry
          // is open-ended at the contract boundary. It is `ResolvedThresholds`
          // by construction: the same `resolveThresholds` builds both.
          thresholds: (await callAction(context, "rhythm.read", {}))
            .thresholds as unknown as ResolvedThresholds,
          checkTitles: [...OBJECTIVE_CHECKS, ...KEY_RESULT_CHECKS].map(
            (check) => ({ id: check.id, title: check.title }),
          ),
        }
      : {
          goals: [],
          members: [],
          thresholds: canonThresholds(),
          checkTitles: [],
        };

  return (
    <AppShellLayout>
      <div className="flex flex-col gap-4.5 xl:flex-row">
        <div className="w-full flex-none xl:w-72">
          <PhaseRail phases={workflow.phases} currentPhase={viewing} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4.5">
          <Card>
            <CardHeader className="justify-between">
              <div className="flex flex-col">
                <h1 className="text-base font-bold text-ink">
                  Phase {viewing} · {PHASE_TITLES[viewing]}
                </h1>
                <p className="text-xs text-ink-3">
                  {workflow.name} · completion is computed, never self-reported
                </p>
              </div>
              <Chip tone={workflow.mode === "annual" ? "brand" : "neutral"}>
                {workflow.mode} mode
              </Chip>
            </CardHeader>
            {work.allowed ? null : (
              <CardBody className="flex flex-col gap-1.5 border-warn-dot border-t bg-warn-bg">
                <p className="text-sm font-bold text-warn">
                  This phase is blocked by earlier work
                </p>
                <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-warn">
                  {work.because.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p className="text-xs text-warn">
                  <a className="underline" href="/cycle?phase=1">
                    Go and gather what is missing
                  </a>
                </p>
              </CardBody>
            )}
            {phase && phase.blocked.length > 0 ? (
              <CardBody className="border-line border-t">
                <ul className="flex flex-col gap-0.5 text-xs text-ink-3">
                  {phase.blocked.map((reason) => (
                    <li key={reason}>Not yet checkable: {reason}</li>
                  ))}
                </ul>
              </CardBody>
            ) : null}
            {phase && phase.missing.length > 0 ? (
              <CardBody className="border-line border-t">
                <p className="mb-1 text-xs font-bold tracking-wide text-ink-3 uppercase">
                  Still needed here
                </p>
                <ul className="flex list-disc flex-col gap-0.5 pl-4 text-sm text-ink-2">
                  {phase.missing.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </CardBody>
            ) : null}
          </Card>

          {viewing === 1 ? (
            <InputPack
              cycleId={workflow.cycleId}
              mode={workflow.mode}
              items={workflow.packItems}
              distributedAt={workflow.packDistributedAt}
              sponsor={workflow.sponsor}
              facilitator={workflow.facilitator}
              canEdit={canEdit}
            />
          ) : null}

          {viewing === 2 ? (
            <Diagnose
              cycleId={workflow.cycleId}
              issues={workflow.issues}
              minimum={workflow.asks.strategicIssues}
              canEdit={canEdit}
            />
          ) : null}

          {viewing === 3 ? (
            <Direction
              cycleId={workflow.cycleId}
              mode={workflow.mode}
              priorities={workflow.priorities}
              issues={workflow.issues}
              bounds={workflow.asks.priorities}
              canEdit={canEdit}
            />
          ) : null}

          {viewing === 5 ? (
            <Gates
              cycleId={workflow.cycleId}
              gates={workflow.gates}
              publishable={workflow.publishable}
              publishedAt={workflow.publishedAt}
              canPublish={canPublish}
            />
          ) : null}

          {viewing === 4 ? (
            <Drafting
              cycleId={workflow.cycleId}
              goals={draft.goals}
              members={draft.members}
              canEdit={canEdit}
              thresholds={draft.thresholds}
              checkTitles={draft.checkTitles}
              memberId={workspace.memberId}
              assistsAvailable={await assistsAvailableAction()}
            />
          ) : null}

          {viewing === 0 || viewing === 6 || viewing === 7 ? (
            <Card>
              <CardBody>
                <p className="text-sm text-ink-3">
                  {viewing === 0
                    ? "The annual strategy surface arrives with the frame editor at P4-T02."
                    : viewing === 6
                      ? "The running cadence arrives with check-ins at P3-T07 and sessions at P4-T04."
                      : "Scoring every key result and writing the cycle retrospective arrive with the review at P4-T08. The arithmetic behind the scores is already here."}
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="flex w-full flex-none flex-col gap-4.5 xl:w-80">
          {viewing === 4 ? (
            <QualityPanel
              set={draft.goals.map((goal) => ({
                objective: {
                  id: goal.id,
                  title: goal.title,
                  hasCycle: true,
                  hasTimeframe: false,
                  championId: goal.champion.id,
                  reviewerId: goal.reviewer.id,
                  objectivesInUnit: draft.goals.filter(
                    (other) => other.level === goal.level,
                  ).length,
                  level: goal.level,
                },
                keyResults: goal.keyResults.map((keyResult) => ({
                  id: keyResult.id,
                  title: keyResult.title,
                  baseline: keyResult.baselineValue,
                  target: keyResult.targetValue,
                  dueOn: keyResult.dueOn,
                  ownerId: keyResult.ownerId,
                  indicatorType: keyResult.indicatorType,
                  direction: keyResult.direction,
                  confidence: keyResult.confidence,
                })),
              }))}
              thresholds={draft.thresholds}
              checkTitles={draft.checkTitles}
            />
          ) : null}
          {cycleDecisions.length === 0 ? null : (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-bold text-ink">
                  Decisions this cycle
                </h2>
              </CardHeader>
              <CardBody className="flex flex-col gap-2">
                <ul className="flex flex-col gap-2">
                  {cycleDecisions.map((decision) => (
                    <li key={decision.id} className="flex flex-col gap-0.5">
                      <span className="text-sm text-ink">{decision.text}</span>
                      <span className="text-xs text-ink-3">
                        {decision.goalId ? (
                          <a
                            className="underline"
                            href={`/goals/${decision.goalId}`}
                          >
                            {decision.keyResultTitle ?? decision.goalTitle}
                          </a>
                        ) : (
                          (decision.keyResultTitle ?? decision.goalTitle)
                        )}{" "}
                        · {new Date(decision.at).toLocaleDateString()} ·{" "}
                        {decision.authorName}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-ink-4">
                  Recorded in the monthly reviews. Each one names the key result
                  or the objective it affects.
                </p>
              </CardBody>
            </Card>
          )}
          <GuidanceRail phase={viewing} mode={workflow.mode} />
        </div>
      </div>
    </AppShellLayout>
  );
}
