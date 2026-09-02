import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { ActionForm } from "../../cycle/action-form.tsx";
import {
  linkKeyResultAction,
  setCapacityAction,
  setStatusAction,
  unlinkKeyResultAction,
} from "../actions.ts";
import { InlineSelect } from "../inline-select.tsx";
import {
  CAPACITY_LABEL,
  CAPACITY_OPTIONS,
  CAPACITY_TONE,
  STATUS_LABEL,
  STATUS_OPTIONS,
} from "../labels.ts";
import { UnlinkButton } from "./unlink-button.tsx";

/**
 * One initiative (UIUX-PLAN.md §6 S-26, P5-T10b).
 *
 * S-26 asks for "description, linked key results, tasks and documents". Two of
 * those four do not exist yet, and each says so here rather than being quietly
 * absent: tasks arrive at P5-T11 and documents at P5-T12. Drawing an empty
 * panel labelled "Tasks" would read as a team with no work rather than as a
 * product with no table.
 *
 * **The linked key results are the point of the screen.** METHOD.md §5.5 asks a
 * facilitator to record the main initiatives that will move each measure, and
 * this is the other end of that sentence: from the work, which numbers it is
 * meant to move.
 */
export default async function InitiativePage({
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

  const initiative = await callAction(context, "initiatives.read", {
    id,
  }).catch((error: unknown) => {
    // Not-found is what the access getter answers for both "no such initiative"
    // and "not yours to see", and the page keeps that indistinguishable.
    if (error instanceof OperationError && error.code === "not_found") {
      notFound();
    }
    throw error;
  });

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;

  // Every key result the reader can see, so the link picker offers real
  // choices. Read through `goals.list`, which is already access-filtered.
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
      goalTitle: goal.title,
    })),
  );
  const byId = new Map(keyResults.map((one) => [one.id, one]));
  const linked = initiative.keyResultIds.map((keyResultId) => {
    // A key result outside the current cycle is still linked and still worth
    // naming as linked. Its title is not readable from this page's own list,
    // and inventing one would be worse than saying so.
    const known = byId.get(keyResultId);
    return {
      id: keyResultId,
      title: known?.title ?? "A key result outside this cycle",
      goalTitle: known?.goalTitle ?? "",
    };
  });
  const linkable = keyResults.filter(
    (one) => !initiative.keyResultIds.includes(one.id),
  );

  return (
    <AppShellLayout>
      <div className="flex w-full flex-col gap-3.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Link
                href="/initiatives"
                className="text-xs text-ink-3 hover:text-brand-text"
              >
                Initiatives
              </Link>
              <h1 className="text-lg font-bold text-ink">{initiative.title}</h1>
              <p className="text-xs text-ink-3">
                {initiative.spaceName} · owned by {initiative.ownerName}
                {initiative.startsOn || initiative.endsOn
                  ? ` · ${[initiative.startsOn, initiative.endsOn]
                      .filter(Boolean)
                      .join(" to ")}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              {canEdit ? (
                <>
                  <InlineSelect
                    label="Status"
                    value={initiative.status}
                    options={STATUS_OPTIONS}
                    onSave={setStatusAction.bind(null, initiative.id)}
                  />
                  <InlineSelect
                    label="Capacity"
                    value={initiative.capacity ?? ""}
                    options={CAPACITY_OPTIONS}
                    onSave={setCapacityAction.bind(null, initiative.id)}
                  />
                </>
              ) : (
                <>
                  <Chip tone="neutral">{STATUS_LABEL[initiative.status]}</Chip>
                  <Chip
                    tone={CAPACITY_TONE[initiative.capacity ?? "unjudged"]}
                    dot
                  >
                    {CAPACITY_LABEL[initiative.capacity ?? "unjudged"]}
                  </Chip>
                </>
              )}
            </div>
          </CardHeader>
          {initiative.capacity === "exceeds" ? (
            <CardBody>
              <p className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad">
                This is over capacity, so publish gate five refuses the cycles
                its key results belong to. METHOD.md §5.5: nothing may remain at
                "exceeds" when the set is published, and what was cut has to be
                recorded.
              </p>
            </CardBody>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              The key results this work will move
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {linked.length === 0 ? (
              <p className="rounded-md border border-line border-dashed px-3 py-4 text-center text-sm text-ink-3">
                Nothing yet. An initiative behind no measure is work nobody can
                tell the value of.
              </p>
            ) : (
              <ul
                className="flex flex-col divide-y divide-line"
                data-testid="linked-key-results"
              >
                {linked.map((keyResult) => (
                  <li
                    key={keyResult.id}
                    className="flex items-center gap-2 py-2"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-ink">
                        {keyResult.title}
                      </span>
                      {keyResult.goalTitle ? (
                        <span className="truncate text-xs text-ink-3">
                          {keyResult.goalTitle}
                        </span>
                      ) : null}
                    </div>
                    {canEdit ? (
                      <UnlinkButton
                        label={`Unlink ${keyResult.title}`}
                        onUnlink={unlinkKeyResultAction.bind(
                          null,
                          initiative.id,
                          keyResult.id,
                        )}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {canEdit && linkable.length > 0 ? (
              <ActionForm
                action={linkKeyResultAction}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="id" value={initiative.id} />
                <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-ink-2">
                  Record this work against a key result
                  <select
                    name="keyResultId"
                    aria-label="Key result to link"
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  >
                    {linkable.map((one) => (
                      <option key={one.id} value={one.id}>
                        {one.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand"
                >
                  Link
                </button>
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">What is not here yet</h2>
          </CardHeader>
          <CardBody>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-ink-3">
              <li>
                Tasks and the board arrive at P5-T11. Until then this
                initiative's progress reads zero for everybody, which is honest
                rather than empty: progress is the share of its own tasks that
                are done, and there are no tasks.
              </li>
              <li>Documents and attachments arrive at P5-T12.</li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
