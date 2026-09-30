import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveAccessLevelFor } from "../../lib/access";
import { getPool } from "../../lib/auth";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { ActionForm } from "../cycle/action-form.tsx";
import { createTaskAction, moveTaskAction } from "./actions.ts";
import { Board } from "./board.tsx";

/**
 * The OKR board (UIUX-PLAN.md §6 S-27, P5-T11, completeness review M-02).
 *
 * **The rail carries two numbers and never adds them.** Measured progress is
 * the one that counts; completed linked work over total sits beside it as a
 * different fact about the same key result. When the second is complete and the
 * first has not moved, the sentence `packages/method` writes appears under both.
 * That is TECHNICAL-PLAN §4.9 and the reason the product exists: a team that
 * measures activity instead of outcomes has an OKR practice in name only.
 *
 * **One screen, three boards** (REQUIREMENTS §4 Pillar C). `?space=` is a
 * space's board and the default, `?initiative=` an initiative's and
 * `?keyResult=` a key result's. The last two are reached from the initiative
 * page and from each key result on its goal's page, which is where somebody
 * asking "what work is behind this" already is. Until M-02 the read answered
 * all three and this screen drew only the first.
 *
 * A board of something the reader cannot see is not-found, from the read
 * itself, the same as the page of that thing would be.
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    space?: string;
    initiative?: string;
    keyResult?: string;
  }>;
}) {
  const { t } = await getTranslations();

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
  const narrowed = query.keyResult
    ? { keyResultId: query.keyResult }
    : query.initiative
      ? { initiativeId: query.initiative }
      : null;
  const space = narrowed
    ? null
    : (spaces.find((one) => one.id === query.space) ?? spaces[0]);

  if (!narrowed && !space) {
    return (
      <Card className="w-full">
        <CardBody>
          <p className="text-sm text-ink-3">{t("board.aBoardIsA")}</p>
        </CardBody>
      </Card>
    );
  }

  const board = await callAction(
    context,
    "tasks.board",
    narrowed ?? { spaceId: space?.id as string },
  ).catch((error: unknown) => {
    // The same answer the page of the thing itself gives: a scope nobody may
    // see and a scope that does not exist are indistinguishable.
    if (error instanceof OperationError && error.code === "not_found") {
      notFound();
    }
    throw error;
  });
  const scope = board.scope;

  // The key results a new card can name, read only for somebody who can add
  // one: `cycles.current` is a workspace-wide read a guest may not make.
  const keyResults =
    canEdit && scope.kind !== "key_result"
      ? await currentKeyResults(context)
      : [];

  const cards = board.columns.flatMap((column) => column.cards);
  const tasks =
    cards.length === 1
      ? t("common.count.taskOne", { count: cards.length })
      : t("common.count.taskOther", { count: cards.length });

  return (
    <div className="flex w-full flex-col gap-4.5 xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
        <Card>
          <CardHeader className="justify-between">
            {scope.kind === "space" ? (
              <div className="flex min-w-0 flex-col">
                <h1 className="text-lg font-bold text-ink">
                  {t("board.board")}
                </h1>
                <p className="text-xs text-ink-3" data-testid="board-count">
                  {cards.length === 0
                    ? t("board.noWorkYet")
                    : t("board.tasksInSpace", { tasks, name: scope.title })}
                </p>
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link
                  href={
                    scope.kind === "initiative"
                      ? `/initiatives/${scope.id}`
                      : `/goals/${scope.goalId}#kr-${scope.id}`
                  }
                  className="text-xs text-ink-3 hover:text-brand-text"
                >
                  {scope.kind === "initiative"
                    ? t("board.scope.initiativeBoard")
                    : t("board.scope.keyResultBoard")}
                </Link>
                <h1 className="text-lg font-bold text-ink">{scope.title}</h1>
                {scope.parentTitle ? (
                  <p className="text-xs text-ink-3">
                    {scope.kind === "initiative"
                      ? t("board.scope.inSpace", { name: scope.parentTitle })
                      : t("board.scope.ofObjective", {
                          title: scope.parentTitle,
                        })}
                  </p>
                ) : null}
                <p className="text-xs text-ink-3" data-testid="board-count">
                  {cards.length === 0
                    ? t("board.noWorkYet")
                    : t("board.tasksOnBoard", { tasks })}
                </p>
              </div>
            )}
            {scope.kind === "space" ? (
              <div className="flex flex-wrap gap-1.5">
                {spaces.map((one) => (
                  <Link
                    key={one.id}
                    href={`/board?space=${one.id}`}
                    aria-current={one.id === scope.id ? "true" : undefined}
                    className={
                      one.id === scope.id
                        ? "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
                        : "rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
                    }
                  >
                    {one.name}
                  </Link>
                ))}
              </div>
            ) : scope.spaceId ? (
              <Link
                href={`/board?space=${scope.spaceId}`}
                className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
              >
                {t("board.scope.openSpaceBoard")}
              </Link>
            ) : null}
          </CardHeader>
          <CardBody>
            <Board
              scope={{ kind: scope.kind, id: scope.id }}
              columns={board.columns}
              canEdit={canEdit}
              onMove={moveTaskAction}
            />
          </CardBody>
        </Card>

        {canEdit ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                {t("board.addATask")}
              </h2>
            </CardHeader>
            <CardBody>
              <ActionForm
                action={createTaskAction}
                className="flex flex-col gap-2"
              >
                {/* Work added on a scoped board belongs to what the board is
                    of, and lands in that thing's own space. */}
                {scope.spaceId ? (
                  <input type="hidden" name="spaceId" value={scope.spaceId} />
                ) : null}
                {scope.kind === "initiative" ? (
                  <input type="hidden" name="initiativeId" value={scope.id} />
                ) : null}
                {scope.kind === "key_result" ? (
                  <input type="hidden" name="keyResultId" value={scope.id} />
                ) : null}
                <label
                  className="text-xs font-semibold text-ink-2"
                  htmlFor="title"
                >
                  {t("board.whatHasToHappen")}
                </label>
                <input
                  id="title"
                  name="title"
                  required
                  maxLength={500}
                  placeholder={t("board.rewriteTheFirstRun")}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                />
                <div className="flex flex-wrap gap-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                    {t("board.column")}
                    <select
                      name="status"
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    >
                      <option value="backlog">{t("board.backlog")}</option>
                      <option value="todo">{t("board.toDo")}</option>
                      <option value="in_progress">
                        {t("common.inProgress")}
                      </option>
                      <option value="done">{t("board.done")}</option>
                    </select>
                  </label>
                  {scope.spaceId ? null : (
                    // A key result whose goal belongs to no space: the person
                    // adding the work says where it lives.
                    <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                      {t("board.scope.spaceItLivesIn")}
                      <select
                        name="spaceId"
                        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      >
                        {spaces.map((one) => (
                          <option key={one.id} value={one.id}>
                            {one.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {scope.kind === "key_result" ? null : (
                    <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                      {t("board.keyResultItMoves")}
                      <select
                        name="keyResultId"
                        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      >
                        <option value="">{t("board.noneYet")}</option>
                        {keyResults.map((one) => (
                          <option key={one.id} value={one.id}>
                            {one.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                    {t("board.due")}
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
                  {t("common.add")}
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
              {t("board.whatThisWorkIs")}
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {board.rail.length === 0 ? (
              <p className="rounded-md border border-line border-dashed px-2.5 py-4 text-center text-xs text-ink-3">
                {t("board.noCardOnThis")}
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
                  <span className="text-xs text-ink-3">{entry.goalTitle}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/*
                     * Two chips, labelled differently, never added together.
                     * Progress is the measured value; linked work is a count
                     * of tasks. §4.9 is explicit that the second never
                     * replaces the first.
                     */}
                    <Chip tone="neutral">
                      {t("common.progress2", {
                        progressPct: Math.round(entry.progressPct),
                      })}
                    </Chip>
                    <Chip tone="neutral">
                      {t("board.linkedWork", {
                        done: entry.linkedWork.done,
                        total: entry.linkedWork.total,
                      })}
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
  );
}

/** The current quarter's key results the reader can see, for the add form. */
async function currentKeyResults(context: {
  pool: ReturnType<typeof getPool>;
  workspaceId: string;
  actor: { kind: "human"; userId: string };
}): Promise<{ id: string; title: string }[]> {
  const current = await callAction(context, "cycles.current", {
    mode: "quarterly",
  });
  const { goals } = current
    ? await callAction(context, "goals.list", {
        cycleId: current.id,
        includeClosed: false,
      })
    : { goals: [] };
  return goals.flatMap((goal) =>
    goal.keyResults.map((keyResult) => ({
      id: keyResult.id,
      title: keyResult.title,
    })),
  );
}
