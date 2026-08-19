import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";

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
};

export default async function AgentsPage() {
  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  if (level < ACCESS_LEVELS.full) {
    return (
      <>
        <h1>Agents and runs</h1>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              What the agents did, and to whom, is behind the coaching
              permission. Ask a workspace administrator.
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

  return (
    <>
      <h1>Agents and runs</h1>
      <p className="text-sm text-ink-3">
        Every agent is a member of this workspace, accountable like anyone else.
        None of them holds a workspace-wide grant.
      </p>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">The agents</h2>
        </CardHeader>
        <CardBody className="p-0">
          {agents.length === 0 ? (
            <p className="p-3 text-sm text-ink-3">
              This workspace has no agents. That is unusual: the Champion is
              seeded at provisioning.
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
                  </span>
                  {agent.persona === "" ? null : (
                    <span className="text-xs text-ink-3">{agent.persona}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">Recent runs</h2>
          <Chip tone="neutral">{runs.length} shown</Chip>
        </CardHeader>
        <CardBody className="p-0">
          {runs.length === 0 ? (
            <p className="p-3 text-sm text-ink-3">
              No run yet. Nothing schedules one on this instance, so a run
              happens when somebody asks for it.
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
                    </span>
                  </span>
                  {run.error ? (
                    <span className="text-xs text-bad">{run.error}</span>
                  ) : null}
                  {run.log.length === 0 ? (
                    <span className="text-xs text-ink-4">
                      Nothing was due. A quiet hour is a run too.
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
