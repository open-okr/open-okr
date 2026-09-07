import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import {
  addChecklistItemAction,
  assignTaskAction,
  setChecklistItemAction,
  setDueOnAction,
  setTaskStatusAction,
  unassignTaskAction,
} from "../../board/actions.ts";
import { ActionForm } from "../../cycle/action-form.tsx";
import { InlineSelect } from "../../initiatives/inline-select.tsx";
import { ChecklistLine, DueDateField, RailButton } from "./controls.tsx";

/**
 * One task (UIUX-PLAN.md §6 S-28, P5-T11).
 *
 * Title, status, description, checklist and a right rail with assignees, the
 * due date, the initiative and the key result it serves. Comments and the
 * activity list are not here: the comment surface is P3-T16's and hanging it on
 * a task is its own change, so this says so rather than drawing an empty panel.
 *
 * **The key result on the rail is a link, not a number.** Nothing on this page
 * turns a finished task into progress.
 */
const STATUS_OPTIONS = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
] as const;

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const { id } = await params;

  const task = await callAction(context, "tasks.read", { id }).catch(
    (error: unknown) => {
      if (error instanceof OperationError && error.code === "not_found") {
        notFound();
      }
      throw error;
    },
  );

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;

  const members = canEdit
    ? (await callAction(context, "people.directory", {})).filter(
        (one) => one.kind === "human",
      )
    : [];
  const assigned = new Set(task.assignees.map((one) => one.id));

  return (
    <AppShellLayout>
      <div className="flex w-full flex-col gap-4.5 xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <Card>
            <CardHeader className="justify-between">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link
                  href={`/board?space=${task.spaceId}`}
                  className="text-xs text-ink-3 hover:text-brand-text"
                >
                  {task.spaceName}
                </Link>
                <h1 className="text-lg font-bold text-ink">{task.title}</h1>
              </div>
              {canEdit ? (
                <InlineSelect
                  label="Status"
                  value={task.status}
                  options={STATUS_OPTIONS}
                  onSave={setTaskStatusAction.bind(null, task.id)}
                />
              ) : (
                <Chip tone="neutral">
                  {STATUS_OPTIONS.find((one) => one.value === task.status)
                    ?.label ?? task.status}
                </Chip>
              )}
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="justify-between">
              <h2 className="text-sm font-bold text-ink">Checklist</h2>
              <span className="text-xs text-ink-3">
                {task.checklist.done} of {task.checklist.total} done
              </span>
            </CardHeader>
            <CardBody className="flex flex-col gap-2">
              {task.items.length === 0 ? (
                <p className="rounded-md border border-line border-dashed px-2.5 py-4 text-center text-xs text-ink-3">
                  Nothing broken down yet.
                </p>
              ) : (
                <ul
                  className="flex flex-col gap-1"
                  data-testid="task-checklist"
                >
                  {task.items.map((item) => (
                    <ChecklistLine
                      key={item.id}
                      title={item.title}
                      done={item.done}
                      disabled={!canEdit}
                      onToggle={setChecklistItemAction.bind(
                        null,
                        task.id,
                        item.id,
                      )}
                    />
                  ))}
                </ul>
              )}

              {canEdit ? (
                <ActionForm
                  action={addChecklistItemAction}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="id" value={task.id} />
                  <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-ink-2">
                    Add a line
                    <input
                      name="title"
                      maxLength={300}
                      placeholder="Draft the copy"
                      className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                    />
                  </label>
                  <button
                    type="submit"
                    className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand"
                  >
                    Add
                  </button>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                What is not here yet
              </h2>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-ink-3">
                Comments and the activity list are P3-T16's surface, and hanging
                it on a task is its own change. Documents and attachments arrive
                at P5-T12.
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="flex w-full flex-none flex-col gap-3.5 xl:w-80">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">Assignees</h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-2">
              {task.assignees.length === 0 ? (
                <p className="text-xs text-ink-3">Nobody yet.</p>
              ) : (
                <ul
                  className="flex flex-col gap-1"
                  data-testid="task-assignees"
                >
                  {task.assignees.map((one) => (
                    <li
                      key={one.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate text-sm text-ink">
                        {one.name}
                      </span>
                      {canEdit ? (
                        <RailButton
                          label={`Unassign ${one.name}`}
                          text="Remove"
                          onRun={unassignTaskAction.bind(null, task.id, one.id)}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {canEdit
                ? members
                    .filter((one) => !assigned.has(one.id))
                    .map((one) => (
                      <RailButton
                        key={one.id}
                        label={`Assign ${one.name}`}
                        text={`Assign ${one.name}`}
                        onRun={assignTaskAction.bind(null, task.id, one.id)}
                      />
                    ))
                : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">Where it sits</h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-2 text-sm">
              <Row label="Due">
                {canEdit ? (
                  <DueDateField
                    dueOn={task.dueOn}
                    disabled={false}
                    onSave={setDueOnAction.bind(null, task.id)}
                  />
                ) : (
                  <span className="text-ink-2">{task.dueOn ?? "No date"}</span>
                )}
              </Row>
              <Row label="Initiative">
                {task.initiativeId ? (
                  <Link
                    href={`/initiatives/${task.initiativeId}`}
                    className="text-brand-text hover:underline"
                  >
                    {task.initiativeTitle ?? "An initiative"}
                  </Link>
                ) : (
                  <span className="text-ink-3">None</span>
                )}
              </Row>
              <Row label="Key result">
                {task.keyResultTitle ? (
                  <span className="text-ink-2">{task.keyResultTitle}</span>
                ) : (
                  <span className="text-ink-3">None</span>
                )}
              </Row>
            </CardBody>
          </Card>
        </div>
      </div>
    </AppShellLayout>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold text-ink-3">{label}</span>
      {children}
    </div>
  );
}
