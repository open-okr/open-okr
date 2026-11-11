import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import {
  Card,
  CardBody,
  CardHeader,
  Chip,
  EntityPicker,
  SubmitButton,
} from "@openokr/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { resolveAccessLevelFor } from "../../../lib/access";
import { Attachments } from "../../../lib/attachments.tsx";
import { getPool } from "../../../lib/auth";
import { readConversation } from "../../../lib/conversation.ts";
import { CopyLink } from "../../../lib/copy-link.tsx";
import { DeleteControl } from "../../../lib/delete-control.tsx";
import {
  keyResultOption,
  linkableKeyResults,
} from "../../../lib/linkable-key-results";
import { itemTitle } from "../../../lib/page-title.ts";
import { PreviousNext } from "../../../lib/previous-next.tsx";
import { shortLinkPath } from "../../../lib/short-links.ts";
import { SubjectComments } from "../../../lib/subject-comments.tsx";
import { getTranslations } from "../../../lib/translations";
import { WatchControl } from "../../../lib/watch-control.tsx";
import { requireWorkspace } from "../../../lib/workspace";
import { ActionForm } from "../../cycle/action-form.tsx";
import {
  readSubjectDocuments,
  SubjectDocuments,
} from "../../documents/subject-documents.tsx";
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

/** The tab reads this item's own name (lib/page-title.ts). */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return itemTitle(
    "pageTitle.initiative",
    async (context) =>
      (await callAction(context, "initiatives.read", { id })).title,
  );
}

/**
 * One initiative (UIUX-PLAN.md §6 S-26, P5-T10b).
 *
 * S-26 asks for "description, linked key results, tasks and documents". The
 * tasks arrived at P6-G28. The documents, the files beside them and the
 * discussion arrived at completeness review M-01, through the same three
 * panels the goal page mounts: REQUIREMENTS §4 puts documents on an
 * initiative, files on anything a document can hang on, and comments
 * everywhere.
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
  // A short link lands on the page at its key, which every link and form on
  // it is built from (docs/design/short-ids.md S6).
  if (initiative.id !== id) {
    redirect(`/initiatives/${initiative.id}`);
  }

  // Whether this reader is watching this subject (P6-G07b). Read here rather
  // than in the control, because the control is a client component and the
  // answer is part of the page's own first paint.
  const watch = await callAction(context, "subscriptions.read", {
    subjectType: "initiative",
    subjectId: id,
  });

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  // The initiatives either side of this one, in the list's own order, for
  // the links and the `[` and `]` keys (plan 0.7.0, U2). The whole list as
  // the reader may see it: this page's address carries no filter.
  const everyInitiative = await callAction(context, "initiatives.list", {});
  const at = everyInitiative.findIndex((one) => one.id === id);
  const before = at > 0 ? everyInitiative[at - 1] : undefined;
  const after = at >= 0 ? everyInitiative[at + 1] : undefined;

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

  // Documents on this initiative. The query has already dropped anybody
  // else's draft, so the list is safe to render as it comes (P5-T12).
  const documents = await readSubjectDocuments(context, "initiative", id);
  const conversation = await readConversation(context, "initiative", id);

  // The key results this initiative moves, each named with its objective
  // and cycle, whatever cycle it is in (plan 0.8.0 I1). One the reader cannot
  // see is not named; it is counted, so the list does not claim fewer links
  // than there are.
  const named = await callAction(context, "initiatives.keyResults", {
    id: initiative.id,
  });
  const linked = named.map((keyResult) => ({
    id: keyResult.id,
    title: keyResult.title,
    goalTitle: keyResult.cycleName
      ? `${keyResult.goalTitle} · ${keyResult.cycleName}`
      : keyResult.goalTitle,
  }));
  const unseen = initiative.keyResultIds.length - linked.length;
  // What the link picker offers: every active cycle's key results the reader
  // can see, by the rule every picker follows, less those already linked.
  const linkable = canEdit
    ? (await linkableKeyResults(context)).filter(
        (one) => !initiative.keyResultIds.includes(one.id),
      )
    : [];

  return (
    <div className="flex w-full flex-col gap-3.5">
      <Card>
        {/* Wraps the controls under the title, and a long unbroken title
         * breaks rather than squeezing to a few pixels (usability review
         * IN2: 21px wide at 375 with a 200-character title). */}
        <CardHeader className="flex-wrap justify-between">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5 md:max-w-8/12">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link
                href="/initiatives"
                className="text-xs text-ink-3 hover:text-brand-text"
              >
                {t("common.initiatives")}
              </Link>
              <PreviousNext
                previous={
                  before
                    ? {
                        href: `/initiatives/${before.id}`,
                        label: t("initiatives.detail.previous"),
                      }
                    : null
                }
                next={
                  after
                    ? {
                        href: `/initiatives/${after.id}`,
                        label: t("initiatives.detail.next"),
                      }
                    : null
                }
              />
            </div>
            <h1 className="text-lg font-bold text-ink [overflow-wrap:anywhere]">
              {initiative.title}
            </h1>
            <p className="text-xs text-ink-3">
              {t("initiatives.detail.ownedBy", {
                spaceName: initiative.spaceName,
                ownerName: initiative.ownerName,
                to:
                  initiative.startsOn || initiative.endsOn
                    ? ` · ${[initiative.startsOn, initiative.endsOn]
                        .filter(Boolean)
                        .join(" to ")}`
                    : "",
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {canEdit ? (
              <>
                <InlineSelect
                  label={t("checkIn.composer.status")}
                  value={initiative.status}
                  options={STATUS_OPTIONS.map((one) => ({
                    value: one.value,
                    label: t(one.labelKey),
                  }))}
                  onSave={setStatusAction.bind(null, initiative.id)}
                />
                <InlineSelect
                  label={t("cycle.capacity.capacity")}
                  value={initiative.capacity ?? ""}
                  options={CAPACITY_OPTIONS.map((one) => ({
                    value: one.value,
                    label: t(one.labelKey),
                  }))}
                  onSave={setCapacityAction.bind(null, initiative.id)}
                />
              </>
            ) : (
              <>
                <Chip tone="neutral">
                  {t(
                    STATUS_LABEL[initiative.status] ??
                      "initiatives.status.planned",
                  )}
                </Chip>
                <Chip
                  tone={CAPACITY_TONE[initiative.capacity ?? "unjudged"]}
                  dot
                >
                  {t(
                    CAPACITY_LABEL[initiative.capacity ?? "unjudged"] ??
                      "initiatives.capacity.unjudged",
                  )}
                </Chip>
              </>
            )}
          </div>
          <WatchControl
            subjectType="initiative"
            subjectId={id}
            initial={watch}
          />
          <CopyLink path={shortLinkPath("initiative", initiative)} />
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
          {initiative.keyResultIds.length === 0 ? (
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
                      label={t("initiatives.detail.unlinkNamed", {
                        title: keyResult.title,
                      })}
                      onUnlink={unlinkKeyResultAction.bind(
                        null,
                        initiative.id,
                        keyResult.id,
                      )}
                    />
                  ) : null}
                </li>
              ))}
              {unseen > 0 ? (
                <li className="py-2 text-xs text-ink-3">
                  {unseen === 1
                    ? t("initiatives.detail.unseenKeyResultOne")
                    : t("initiatives.detail.unseenKeyResultOther", {
                        count: unseen,
                      })}
                </li>
              ) : null}
            </ul>
          )}

          {canEdit && linkable.length > 0 ? (
            <ActionForm
              action={linkKeyResultAction}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="id" value={initiative.id} />
              <div className="flex flex-1 flex-col gap-1 text-xs font-semibold text-ink-2">
                {t("initiatives.detail.recordThisWorkAgainst")}
                <EntityPicker
                  label={t("initiatives.detail.keyResultToLink")}
                  hideLabel
                  name="keyResultId"
                  required
                  options={linkable.map(keyResultOption)}
                />
              </div>
              <SubmitButton
                bare
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand"
              >
                {t("common.link")}
              </SubmitButton>
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
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("initiatives.detail.tasksOfDone", {
                done: initiative.tasks.done,
                total: initiative.tasks.total,
              })}
            </h2>
            <p className="text-xs text-ink-3">
              {t("initiatives.detail.theWorkThisInitiative")}
            </p>
          </div>
          {/* This initiative's own board (M-02): the same cards, in columns,
              where they can be moved. */}
          <Link
            href={`/board?initiative=${initiative.id}`}
            className="flex-none text-xs font-semibold text-brand-text hover:underline"
          >
            {t("initiatives.detail.openTheBoard")}
          </Link>
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
      <SubjectDocuments
        subjectType="initiative"
        subjectId={id}
        documents={documents}
        canEdit={canEdit}
      />

      <Attachments
        subjectType="initiative"
        subjectId={id}
        attachments={attachments}
        canEdit={level >= ACCESS_LEVELS.edit}
      />

      <Card>
        <CardBody>
          <SubjectComments
            subjectType="initiative"
            subjectId={id}
            comments={conversation.comments}
            reactions={conversation.reactions}
            currentMemberId={workspace.memberId}
          />
        </CardBody>
      </Card>

      {level >= ACCESS_LEVELS.full ? (
        <DeleteControl subject="initiative" id={id} returnTo="/initiatives" />
      ) : null}
    </div>
  );
}
