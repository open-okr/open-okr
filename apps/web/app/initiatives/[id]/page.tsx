import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveAccessLevelFor } from "../../../lib/access";
import { Attachments } from "../../../lib/attachments.tsx";
import { getPool } from "../../../lib/auth";
import { DeleteControl } from "../../../lib/delete-control.tsx";
import { getTranslations } from "../../../lib/translations";
import { WatchControl } from "../../../lib/watch-control.tsx";
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
 * those four are not on this page yet, and each says so here rather than being
 * quietly absent. Their tables landed at P5-T11 and P5-T12 and the panels are
 * P6-G28's; until then, drawing an empty panel labelled "Tasks" would read as a
 * team with no work rather than as a page that cannot see the work.
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
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const { id } = await params;

  // Whether this reader is watching this subject (P6-G07b). Read here rather
  // than in the control, because the control is a client component and the
  // answer is part of the page's own first paint.
  const watch = await callAction(context, "subscriptions.read", {
    subjectType: "initiative",
    subjectId: id,
  });

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

  // The files on this subject (P6-G27b). Seven attachment actions shipped and
  // none of them had a caller anywhere.
  // This initiative's own tasks (P6-G28). `tasks.list` gained the filter with
  // this row: the board is per space and the other filters are per person or
  // per date, so nothing could answer "the work this initiative is made of".
  const initiativeTasks = await callAction(context, "tasks.list", {
    initiativeId: id,
  });

  const attachments = await callAction(context, "attachments.list", {
    subjectType: "initiative",
    subjectId: id,
  });
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
    <div className="flex w-full flex-col gap-3.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link
              href="/initiatives"
              className="text-xs text-ink-3 hover:text-brand-text"
            >
              {t("common.initiatives")}
            </Link>
            <h1 className="text-lg font-bold text-ink">{initiative.title}</h1>
            <p className="text-xs text-ink-3">
              {initiative.spaceName} {t("initiatives.detail.ownedBy")}{" "}
              {initiative.ownerName}
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
          <WatchControl
            subjectType="initiative"
            subjectId={id}
            initial={watch}
          />
        </CardHeader>
        {initiative.capacity === "exceeds" ? (
          <CardBody>
            <p className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad">
              {t("initiatives.detail.thisIsOverCapacity")}
            </p>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("initiatives.detail.theKeyResultsThis")}
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {linked.length === 0 ? (
            <p className="rounded-md border border-line border-dashed px-3 py-4 text-center text-sm text-ink-3">
              {t("initiatives.detail.nothingYetAnInitiative")}
            </p>
          ) : (
            <ul
              className="flex flex-col divide-y divide-line"
              data-testid="linked-key-results"
            >
              {linked.map((keyResult) => (
                <li key={keyResult.id} className="flex items-center gap-2 py-2">
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
                {t("initiatives.detail.recordThisWorkAgainst")}
                <select
                  name="keyResultId"
                  aria-label={t("initiatives.detail.keyResultToLink")}
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
                {t("common.link")}
              </button>
            </ActionForm>
          ) : null}
        </CardBody>
      </Card>

      {/*
       * The tasks this initiative is made of (S-26, P6-G28).
       *
       * **The progress figure above is the share of these that are done.**
       * `initiatives.progress_pct` exists as a column and nothing has ever
       * written to it, so every initiative in the product read nought per
       * cent; the read derives it from exactly this list now.
       *
       * An initiative with no tasks says so rather than drawing a zero bar:
       * that is not nought per cent done, it is a plan nobody has broken
       * down yet, and the two deserve different sentences.
       */}
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("initiatives.detail.tasks")}
              {initiative.tasks.done} {t("common.of")} {initiative.tasks.total}{" "}
              {t("initiatives.detail.done")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("initiatives.detail.theWorkThisInitiative")}
            </p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-2.5">
          {initiativeTasks.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("initiatives.detail.noTasksYetAn")}
            </p>
          ) : (
            <ul
              className="flex flex-col gap-1.5"
              data-testid="initiative-tasks"
            >
              {initiativeTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <Link
                    href={`/tasks/${task.id}`}
                    className="min-w-0 text-sm text-brand-text hover:underline"
                  >
                    {task.title}
                  </Link>
                  <span className="flex items-center gap-2.5 text-xs text-ink-4">
                    <Chip tone={task.status === "done" ? "ok" : "neutral"}>
                      {task.status.replace("_", " ")}
                    </Chip>
                    {task.dueOn ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Attachments
        subjectType="initiative"
        subjectId={id}
        attachments={attachments}
        canEdit={level >= ACCESS_LEVELS.edit}
      />

      {level >= ACCESS_LEVELS.full ? (
        <DeleteControl
          subject="initiative"
          id={id}
          what="this initiative"
          returnTo="/initiatives"
        />
      ) : null}
    </div>
  );
}
