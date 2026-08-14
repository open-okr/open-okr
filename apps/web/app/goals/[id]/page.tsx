import {
  ACCESS_LEVELS,
  callAction,
  excerptRichText,
  OperationError,
} from "@openokr/core";
import { Bar, Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { notFound } from "next/navigation";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { ActionForm } from "../../cycle/action-form.tsx";
import {
  closeGoal,
  editGoal,
  reassignRole,
  recordValue,
  reopenGoal,
} from "./actions.ts";
import { Rail } from "./rail.tsx";
import { Sparkline } from "./sparkline.tsx";

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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

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

  const relations = await callAction(context, "goals.relations", { id });

  // One history per key result. A goal carries a handful, so this is a handful
  // of small reads rather than a join that would return every value in the
  // workspace to draw four lines.
  const histories = new Map<
    string,
    readonly { readonly value: number; readonly at: string }[]
  >();
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
  const cycles = await callAction(context, "cycles.list", {});
  const cycleEndsOn =
    cycles.find((cycle) => cycle.id === goal.cycleId)?.endsOn ?? null;
  const horizonFor = (dueOn: string | null): number | null => {
    const date = cycleEndsOn ?? dueOn;
    return date ? new Date(`${date}T00:00:00Z`).getTime() : null;
  };

  return (
    <AppShellLayout>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4.5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4.5">
          <Card>
            <CardHeader className="justify-between">
              <div className="flex min-w-0 flex-col">
                <h1 className="text-lg font-bold text-ink">{goal.title}</h1>
                <p className="text-xs text-ink-3">
                  {goal.level} · {goal.champion.name} champions it,{" "}
                  {goal.reviewer.name} reviews it · weight {goal.weight}
                </p>
              </div>
              <Chip tone={closed ? "neutral" : "brand"}>
                {closed
                  ? `closed · ${goal.successStatus}`
                  : goal.health.replace("_", " ")}
              </Chip>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <Bar value={goal.progressPct} className="h-1.5 flex-1" />
                <span className="text-xs font-semibold text-ink-3">
                  {Math.round(goal.progressPct)}%
                </span>
              </div>
              {goal.nextCheckInOn ? (
                <p className="text-xs text-ink-3">
                  Next check-in due {goal.nextCheckInOn}
                  {goal.daysPastDue !== null && goal.daysPastDue > 0
                    ? ` · ${goal.daysPastDue} day${goal.daysPastDue === 1 ? "" : "s"} overdue`
                    : ""}
                </p>
              ) : (
                <p className="text-xs text-ink-3">
                  No check-in is due. A closed goal never is.
                </p>
              )}
              <p className="text-xs text-ink-3">
                {goal.contributionStatement ??
                  "No parent and no contribution statement, so publish gate 3 is red."}
              </p>
              {goal.progressPct === 0 ? (
                <p className="text-xs text-ink-4">
                  Nothing has moved yet. Progress is the weighted average of the
                  key results, recomputed on every write, and health follows the
                  §3.5 precedence rather than a formula over progress.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                Key results ({goal.keyResults.length})
              </h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-2.5">
              {goal.keyResults.length === 0 ? (
                <p className="text-sm text-ink-3">
                  None yet. Without one, nothing about this objective is
                  measurable.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {goal.keyResults.map((keyResult) => (
                    <li
                      key={keyResult.id}
                      className="flex items-start justify-between gap-2.5 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm text-ink">
                          {keyResult.title}
                        </span>
                        <span className="text-xs text-ink-3">
                          {keyResult.direction} · {keyResult.indicatorType} ·{" "}
                          {keyResult.baselineValue} to {keyResult.targetValue}
                          {keyResult.unit ? ` ${keyResult.unit}` : ""} · weight{" "}
                          {keyResult.weight}
                        </span>
                        <Sparkline
                          history={histories.get(keyResult.id) ?? []}
                          direction={keyResult.direction}
                          baseline={keyResult.baselineValue}
                          target={keyResult.targetValue}
                          horizonAt={horizonFor(keyResult.dueOn)}
                        />
                      </span>
                      <span className="flex flex-none flex-col items-end gap-1">
                        <span className="text-sm font-bold text-ink">
                          {keyResult.currentValue}
                          {keyResult.unit ? ` ${keyResult.unit}` : ""}
                        </span>
                        {canEdit && !closed && keyResult.kpiId === null ? (
                          <ActionForm
                            action={recordValue}
                            className="flex items-center gap-1"
                          >
                            {/* The goal, so the write knows which page to
                                revalidate. The key result alone would leave the
                                action guessing. */}
                            <input
                              type="hidden"
                              name="goalId"
                              value={goal.id}
                            />
                            <input
                              type="hidden"
                              name="keyResultId"
                              value={keyResult.id}
                            />
                            <label
                              className="sr-only"
                              htmlFor={`value-${keyResult.id}`}
                            >
                              New value for {keyResult.title}
                            </label>
                            <input
                              id={`value-${keyResult.id}`}
                              name="value"
                              type="number"
                              step="any"
                              defaultValue={keyResult.currentValue}
                              className="w-20 rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-ink"
                            />
                            <label
                              className="sr-only"
                              htmlFor={`confidence-${keyResult.id}`}
                            >
                              Confidence for {keyResult.title}
                            </label>
                            <input
                              id={`confidence-${keyResult.id}`}
                              name="confidence"
                              type="range"
                              min="0"
                              max="1"
                              step="0.1"
                              defaultValue={keyResult.confidence ?? 0.5}
                              className="w-20"
                            />
                            <Button type="submit" size="sm">
                              Save
                            </Button>
                          </ActionForm>
                        ) : keyResult.kpiId ? (
                          <Chip tone="info">from a KPI</Chip>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-ink-4">
                Key results are added and moved on the drafting surface, at{" "}
                <a className="underline" href="/cycle?phase=4">
                  phase 4 of the cycle
                </a>
                .
              </p>
            </CardBody>
          </Card>

          {canEdit && !closed ? (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-bold text-ink">Edit</h2>
              </CardHeader>
              <CardBody>
                <ActionForm action={editGoal} className="flex flex-col gap-1.5">
                  <input type="hidden" name="id" value={goal.id} />
                  <label className="sr-only" htmlFor="edit-title">
                    The objective
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
                    What it contributes to
                  </label>
                  <input
                    id="edit-contribution"
                    name="contributionStatement"
                    maxLength={1000}
                    defaultValue={goal.contributionStatement ?? ""}
                    placeholder="The priority this moves forward"
                    className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
                  />
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-ink-3" htmlFor="edit-weight">
                      Weight
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
                      0 means tracked but not counted
                    </span>
                    <Button type="submit" className="ml-auto">
                      Save
                    </Button>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {canAdminister ? (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-bold text-ink">Roles</h2>
              </CardHeader>
              <CardBody className="flex flex-col gap-2.5">
                <p className="text-xs text-ink-3">
                  Both roles are access-bearing, so moving one rebinds access
                  with it rather than only changing a name.
                </p>
                <ActionForm
                  action={reassignRole}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <input type="hidden" name="id" value={goal.id} />
                  <label className="sr-only" htmlFor="reassign-role">
                    Role
                  </label>
                  <select
                    id="reassign-role"
                    name="role"
                    defaultValue="champion"
                    className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                  >
                    <option value="champion">Champion</option>
                    <option value="reviewer">Reviewer</option>
                  </select>
                  <label className="sr-only" htmlFor="reassign-member">
                    Member
                  </label>
                  <select
                    id="reassign-member"
                    name="memberId"
                    required
                    className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                  >
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="ghost">
                    Reassign
                  </Button>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {goal.retrospective ? (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-bold text-ink">Retrospective</h2>
              </CardHeader>
              <CardBody className="flex flex-col gap-1.5">
                <p className="text-sm text-ink-2">
                  {excerptRichText(goal.retrospective.body as never, 2000) ||
                    "Written, but empty."}
                </p>
                <p className="text-xs text-ink-4">
                  Kept whether the goal is open or closed. Reopening does not
                  erase what happened.
                </p>
              </CardBody>
            </Card>
          ) : null}

          {canEdit ? (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-bold text-ink">
                  {closed ? "Reopen" : "Close"}
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
                      Reopening clears the outcome and the decision, and keeps
                      the retrospective. Health goes back to pending.
                    </p>
                    <Button
                      type="submit"
                      variant="ghost"
                      className="self-start"
                    >
                      Reopen this goal
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
                        Outcome
                      </label>
                      <select
                        id="close-outcome"
                        name="successStatus"
                        defaultValue="achieved"
                        className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                      >
                        <option value="achieved">Achieved</option>
                        <option value="missed">Missed</option>
                      </select>
                      <label className="sr-only" htmlFor="close-decision">
                        Decision
                      </label>
                      <select
                        id="close-decision"
                        name="closeDecision"
                        defaultValue="keep"
                        className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                      >
                        <option value="keep">Keep</option>
                        <option value="modify">Modify</option>
                        <option value="abandon">Abandon</option>
                      </select>
                      <input
                        name="closeReason"
                        maxLength={2000}
                        placeholder="Why that decision?"
                        aria-label="Why that decision?"
                        className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
                      />
                    </div>
                    <label className="sr-only" htmlFor="close-retrospective">
                      The retrospective
                    </label>
                    <textarea
                      id="close-retrospective"
                      name="retrospective"
                      rows={4}
                      required
                      placeholder="What happened, and what would you do differently?"
                      className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      className="self-start"
                    >
                      Close this goal
                    </Button>
                  </ActionForm>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <aside className="w-full flex-none lg:w-80">
          <Rail relations={relations} level={goal.level} />
        </aside>
      </div>
    </AppShellLayout>
  );
}
