import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../lib/access";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { ActionForm } from "../cycle/action-form.tsx";
import { createTaskAction, moveTaskAction } from "./actions.ts";
import { Board } from "./board.tsx";

/**
 * The OKR board (UIUX-PLAN.md §6 S-27, P5-T11).
 *
 * **The rail carries two numbers and never adds them.** Measured progress is
 * the one that counts; completed linked work over total sits beside it as a
 * different fact about the same key result. When the second is complete and the
 * first has not moved, the sentence `packages/method` writes appears under both.
 * That is TECHNICAL-PLAN §4.9 and the reason the product exists: a team that
 * measures activity instead of outcomes has an OKR practice in name only.
 *
 * One board per space here. The same read answers an initiative's board and a
 * key result's, and the initiative and goal pages reach them; a switcher on this
 * screen would be a fourth way to ask one question.
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string }>;
}) {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const query = await searchParams;

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;

  const spaces = await callAction(context, "spaces.list", {});
  const space = spaces.find((one) => one.id === query.space) ?? spaces[0];

  if (!space) {
    return (
      <AppShellLayout>
        <Card className="w-full">
          <CardBody>
            <p className="text-sm text-ink-3">
              A board is a view over a space's work, and this workspace has no
              space yet.
            </p>
          </CardBody>
        </Card>
      </AppShellLayout>
    );
  }

  const board = await callAction(context, "tasks.board", { spaceId: space.id });
  const current = await callAction(context, "cycles.current", {
    mode: "quarterly",
  });
  const { goals } = current
    ? await callAction(context, "goals.list", {
        cycleId: current.id,
        includeClosed: false,
      })
    : { goals: [] };
  const keyResults = goals.flatMap((goal) =>
    goal.keyResults.map((keyResult) => ({
      id: keyResult.id,
      title: keyResult.title,
    })),
  );

  const cards = board.columns.flatMap((column) => column.cards);

  return (
    <AppShellLayout>
      <div className="flex w-full flex-col gap-4.5 xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <Card>
            <CardHeader className="justify-between">
              <div className="flex min-w-0 flex-col">
                <h1 className="text-lg font-bold text-ink">Board</h1>
                <p className="text-xs text-ink-3" data-testid="board-count">
                  {cards.length === 0
                    ? "No work on this board yet."
                    : `${cards.length} ${cards.length === 1 ? "task" : "tasks"} in ${space.name}.`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {spaces.map((one) => (
                  <Link
                    key={one.id}
                    href={`/board?space=${one.id}`}
                    aria-current={one.id === space.id ? "true" : undefined}
                    className={
                      one.id === space.id
                        ? "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
                        : "rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
                    }
                  >
                    {one.name}
                  </Link>
                ))}
              </div>
            </CardHeader>
            <CardBody>
              <Board
                spaceId={space.id}
                columns={board.columns}
                canEdit={canEdit}
                onMove={moveTaskAction}
              />
            </CardBody>
          </Card>

          {canEdit ? (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-bold text-ink">Add a task</h2>
              </CardHeader>
              <CardBody>
                <ActionForm
                  action={createTaskAction}
                  className="flex flex-col gap-2"
                >
                  <input type="hidden" name="spaceId" value={space.id} />
                  <label
                    className="text-xs font-semibold text-ink-2"
                    htmlFor="title"
                  >
                    What has to happen
                  </label>
                  <input
                    id="title"
                    name="title"
                    required
                    maxLength={500}
                    placeholder="Rewrite the first-run screen"
                    className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                  />
                  <div className="flex flex-wrap gap-2">
                    <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                      Column
                      <select
                        name="status"
                        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      >
                        <option value="backlog">Backlog</option>
                        <option value="todo">To do</option>
                        <option value="in_progress">In progress</option>
                        <option value="done">Done</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                      Key result it moves
                      <select
                        name="keyResultId"
                        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      >
                        <option value="">None yet</option>
                        {keyResults.map((one) => (
                          <option key={one.id} value={one.id}>
                            {one.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                      Due
                      <input
                        type="date"
                        name="dueOn"
                        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    className="self-start rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand"
                  >
                    Add
                  </button>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="flex w-full flex-none flex-col gap-3.5 xl:w-80">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                What this work is meant to move
              </h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              {board.rail.length === 0 ? (
                <p className="rounded-md border border-line border-dashed px-2.5 py-4 text-center text-xs text-ink-3">
                  No card on this board names a key result yet. Work that serves
                  no measure is work nobody can tell the value of.
                </p>
              ) : (
                board.rail.map((entry) => (
                  <div
                    key={entry.keyResultId}
                    data-testid="rail-entry"
                    className="flex flex-col gap-1 border-line border-b pb-3 last:border-b-0 last:pb-0"
                  >
                    <span className="text-sm text-ink">
                      {entry.keyResultTitle}
                    </span>
                    <span className="text-xs text-ink-3">
                      {entry.goalTitle}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/*
                       * Two chips, labelled differently, never added together.
                       * Progress is the measured value; linked work is a count
                       * of tasks. §4.9 is explicit that the second never
                       * replaces the first.
                       */}
                      <Chip tone="neutral">
                        Progress {Math.round(entry.progressPct)}%
                      </Chip>
                      <Chip tone="neutral">
                        Linked work {entry.linkedWork.done}/
                        {entry.linkedWork.total}
                      </Chip>
                    </div>
                    {entry.divergence ? (
                      <p
                        data-testid="rail-divergence"
                        className="rounded-md bg-warn-bg px-2 py-1.5 text-xs text-warn"
                      >
                        {entry.divergence}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </AppShellLayout>
  );
}
