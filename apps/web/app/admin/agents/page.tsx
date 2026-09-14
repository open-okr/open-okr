import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { AGENT_AUTONOMIES } from "@openokr/db";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { AgentPolicy } from "./agent-policy.tsx";
import { AgentSwitch, CancelRun } from "./agent-switch";
import { ProposalQueue } from "./proposal-queue";
import { RunControls } from "./run-controls";

/**
 * The agents and their run log (UIUX-PLAN.md §4 S-36, P4-T05a).
 *
 * An agent that acts on people's behalf has to be readable by the people it
 * acts on. This is the page that answers "what did it do, and why", and it
 * shows the log rather than a count: "three nudges" cannot tell an
 * administrator which rule fired, and the rule is the only part anybody can
 * argue with.
 *
 * A halted run is shown as halted, with the reason in its own log, rather than
 * as an absence. The Champion's cost cap stops a run without failing it, and a
 * page that showed nothing for that hour would leave somebody looking for a
 * bug that is not there.
 *
 * Behind `full`, the same permission as the nudge volume card and for the same
 * reason: a run log names who was spoken to.
 */

const STATUS_TONE: Record<string, "ok" | "neutral" | "warn" | "bad"> = {
  completed: "ok",
  running: "neutral",
  planning: "neutral",
  // A halt is not a failure. The cost cap is a limit the workspace chose, and
  // colouring it the same as a crash would teach people to ignore both.
  cancelled: "warn",
  failed: "bad",
};

const SCHEDULE_LABEL: Record<string, string> = {
  manual: "Only when asked",
  continuous: "On every write",
  nightly: "Nightly",
  hourly: "On the hour",
  // Added with the two schedule values P4-T05b opened up. A schedule with no
  // label here would have rendered the raw enum, which is the kind of leak a
  // map like this exists to prevent.
  daily: "Once a day",
  weekly: "Once a week",
};

/**
 * The four access levels a scope binding may carry (P6-G13b).
 *
 * Built here rather than in the card, because a client component that imports
 * `ACCESS_LEVELS` from `@openokr/core` pulls the database layer into its
 * bundle and the build fails on `dns` and `fs`.
 */
const BINDING_LEVELS = [
  { value: ACCESS_LEVELS.view, label: "view" },
  { value: ACCESS_LEVELS.comment, label: "comment" },
  { value: ACCESS_LEVELS.edit, label: "edit" },
  { value: ACCESS_LEVELS.full, label: "full" },
];

export default async function AgentsPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  if (level < ACCESS_LEVELS.full) {
    return (
      <>
        <h1 className="text-lg font-bold text-ink">
          {t("admin.agents.agentsAndRuns")}
        </h1>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              {t("admin.agents.whatTheAgentsDid")}
            </p>
          </CardBody>
        </Card>
      </>
    );
  }

  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const agents = await callAction(context, "agents.list", {});
  const runs = await callAction(context, "agents.listRuns", { limit: 20 });
  // The review queue (P6-G13a). Pending only: an applied or dismissed proposal
  // is history, and the run log already carries it.
  //
  // Agent proposals only. A row with no `run_id` came from a copilot thread and
  // belongs to the panel that asked for it: the person who typed the question
  // is the one who decides, and putting it in a shared administrative queue
  // would hand their conversation to somebody else. The same filter the review
  // inbox applies at P6-G02.
  const proposals = (
    await callAction(context, "proposals.list", { status: "pending" })
  ).filter((proposal) => proposal.runId !== null);

  // Whether a run could draft anything, asked of the stored configuration
  // rather than assumed. The control says which of the two products this
  // workspace is running, because "deterministic only" is a complete product
  // and not a degraded one.
  const providers = await callAction(context, "ai.readProviderConfig", {});
  const drafting = providers.some(
    (entry) => entry.enabled && entry.hasWorkspaceCredential,
  );

  return (
    <>
      <h1 className="text-lg font-bold text-ink">
        {t("admin.agents.agentsAndRuns")}
      </h1>
      <p className="text-sm text-ink-3">{t("admin.agents.everyAgentIsA")}</p>

      <RunControls drafting={drafting} />

      {/* Above the agents and the runs on purpose. A proposal is the one thing
          on this screen that is waiting on the reader, and everything else is a
          record of what already happened (P6-G13a). */}
      <ProposalQueue proposals={proposals} />

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("admin.agents.theAgents")}
          </h2>
        </CardHeader>
        <CardBody className="p-0">
          {agents.length === 0 ? (
            <p className="p-3 text-sm text-ink-3">
              {t("admin.agents.thisWorkspaceHasNo")}
            </p>
          ) : (
            <ul className="flex flex-col">
              {agents.map((agent) => (
                <li
                  key={agent.id}
                  className="flex flex-col gap-1 border-line border-b px-3 py-2 last:border-b-0"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {agent.name}
                    </span>
                    <Chip tone={agent.enabled ? "ok" : "neutral"}>
                      {agent.enabled ? "On" : "Off"}
                    </Chip>
                    <Chip tone="neutral">
                      {SCHEDULE_LABEL[agent.schedule] ?? agent.schedule}
                    </Chip>
                    <Chip tone="agent">{agent.autonomy}</Chip>
                    <span className="ml-auto">
                      <AgentSwitch
                        id={agent.id}
                        enabled={agent.enabled}
                        name={agent.name}
                      />
                    </span>
                  </span>
                  {agent.persona === "" ? null : (
                    <span className="text-xs text-ink-3">{agent.persona}</span>
                  )}
                  {/* The write policy and the scope binder (P6-G13b). */}
                  <AgentPolicy
                    agentId={agent.id}
                    autonomy={agent.autonomy}
                    name={agent.name}
                    autonomies={[...AGENT_AUTONOMIES]}
                    levels={BINDING_LEVELS}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">
            {t("common.recentRuns")}
          </h2>
          <Chip tone="neutral">
            {runs.length} {t("admin.agents.shown")}
          </Chip>
        </CardHeader>
        <CardBody className="p-0">
          {runs.length === 0 ? (
            <p className="p-3 text-sm text-ink-3">
              {t("admin.agents.noRunYetNothing")}
            </p>
          ) : (
            <ul className="flex flex-col">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-col gap-1.5 border-line border-b px-3 py-2 last:border-b-0"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">
                        {run.agentName}
                      </span>
                      <span className="font-mono text-xs text-ink-3">
                        {run.trigger}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Chip tone={STATUS_TONE[run.status] ?? "neutral"}>
                        {run.status}
                      </Chip>
                      {run.finishedAt ? (
                        <span className="text-xs tabular-nums text-ink-4">
                          {run.finishedAt.slice(0, 16).replace("T", " ")}
                        </span>
                      ) : null}
                      {/* Only a run that has not finished can be stopped, and
                          the action refuses the rest anyway (P6-G13a). */}
                      {run.status === "running" || run.status === "planning" ? (
                        <CancelRun id={run.id} />
                      ) : null}
                    </span>
                  </span>
                  {run.error ? (
                    <span className="text-xs text-bad">{run.error}</span>
                  ) : null}
                  {run.log.length === 0 ? (
                    <span className="text-xs text-ink-4">
                      {t("admin.agents.nothingWasDueA")}
                    </span>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {run.log.map((entry) => (
                        <li
                          key={`${run.id}-${entry.taskIndex}-${entry.kind}`}
                          className="text-xs text-ink-2"
                        >
                          <span className="font-mono text-ink-4">
                            {entry.kind}
                          </span>{" "}
                          {entry.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
