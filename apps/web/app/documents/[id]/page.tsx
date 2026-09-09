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
import { publishDocumentAction, updateDocumentAction } from "../actions.ts";
import { DocumentEditor } from "../document-editor.tsx";

/**
 * One document (UIUX-PLAN.md §6 S-29, P5-T12).
 *
 * **A draft says it is a draft, on the page, in words.** The privacy rule is
 * enforced in the query and a reader who should not see this never reaches
 * here, but the author needs to know which of the two states they are looking
 * at before they hit publish: the difference is whether anybody else has been
 * told.
 *
 * The version history shows what changed between the last two published
 * versions, computed from the stored editor JSON through the one shared
 * rich-text module.
 */

/** Where a document's subject lives, when the reader can be sent there. */
const SUBJECT_HREF: Readonly<Record<string, (id: string) => string | null>> = {
  goal: (id) => `/goals/${id}`,
  space: (id) => `/spaces/${id}`,
  initiative: (id) => `/initiatives/${id}`,
  key_result: () => null,
  cycle: () => "/cycle",
  session: (id) => `/session/${id}`,
};

export default async function DocumentPage({
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
    subjectType: "document",
    subjectId: id,
  });

  const document = await callAction(context, "documents.read", { id }).catch(
    (error: unknown) => {
      // Somebody else's draft answers exactly as one that never existed.
      if (error instanceof OperationError && error.code === "not_found") {
        notFound();
      }
      throw error;
    },
  );

  const difference = await callAction(context, "documents.difference", { id });

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  // The files on this subject (P6-G27b). Seven attachment actions shipped and
  // none of them had a caller anywhere.
  const attachments = await callAction(context, "attachments.list", {
    subjectType: "document",
    subjectId: id,
  });
  const canEdit = level >= ACCESS_LEVELS.edit;
  const back = SUBJECT_HREF[document.subjectType]?.(document.subjectId) ?? null;

  return (
    <div className="flex w-full flex-col gap-4.5 xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col gap-0.5">
              {back ? (
                <Link
                  href={back}
                  className="text-xs text-ink-3 hover:text-brand-text"
                >
                  {t("documents.detail.backToThe")}{" "}
                  {document.subjectType.replace("_", " ")}
                </Link>
              ) : (
                <span className="text-xs text-ink-3">
                  {t("documents.detail.onA")}{" "}
                  {document.subjectType.replace("_", " ")}
                </span>
              )}
              <h1 className="text-lg font-bold text-ink">{document.title}</h1>
              <p className="text-xs text-ink-3">
                {document.authorName}
                {document.publishedAt
                  ? ` · published ${document.publishedAt.slice(0, 10)}`
                  : ""}
              </p>
            </div>
            <Chip tone={document.state === "draft" ? "warn" : "ok"} dot>
              {document.state === "draft" ? "Draft" : "Published"}
            </Chip>
            <WatchControl
              subjectType="document"
              subjectId={id}
              initial={watch}
            />
          </CardHeader>
          {document.state === "draft" ? (
            <CardBody>
              <p className="rounded-md bg-warn-bg px-2.5 py-1.5 text-xs text-warn">
                {t("documents.detail.onlyYouCanSee")}
              </p>
            </CardBody>
          ) : null}
          <CardBody>
            <DocumentEditor
              body={document.body}
              state={document.state}
              canEdit={canEdit}
              onSave={updateDocumentAction.bind(
                null,
                document.id,
                document.subjectType,
                document.subjectId,
              )}
              onPublish={publishDocumentAction.bind(
                null,
                document.id,
                document.subjectType,
                document.subjectId,
              )}
            />
          </CardBody>
        </Card>
      </div>

      <div className="flex w-full flex-none flex-col gap-3.5 xl:w-80">
        <Card>
          <CardHeader className="justify-between">
            <h2 className="text-sm font-bold text-ink">
              {t("documents.detail.history")}
            </h2>
            <span className="text-xs text-ink-3">
              {document.versionCount === 0
                ? "Never published"
                : `${document.versionCount} version${
                    document.versionCount === 1 ? "" : "s"
                  }`}
            </span>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {document.versions.length === 0 ? (
              <p className="text-xs text-ink-3">
                {t("documents.detail.nothingYetAVersion")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1" data-testid="doc-versions">
                {document.versions.map((version) => (
                  <li
                    key={version.id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="text-ink-2">
                      {t("documents.detail.version")} {version.version}
                    </span>
                    <span className="truncate text-ink-3">
                      {version.authorName} · {version.createdAt.slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {difference.to !== null && difference.from !== null ? (
              <div className="flex flex-col gap-1" data-testid="doc-difference">
                <p className="text-xs font-semibold text-ink-2">
                  {t("documents.detail.whatChangedBetweenVersion")}{" "}
                  {difference.from} {t("documents.detail.and")} {difference.to}
                </p>
                <p className="text-xs text-ink-3">
                  {difference.added} {t("documents.detail.added")}{" "}
                  {difference.removed} {t("documents.detail.removed")}
                </p>
                {difference.truncated ? (
                  <p className="text-xs text-ink-3">
                    {t("documents.detail.tooLongToCompare")}
                  </p>
                ) : null}
                <ul className="flex flex-col gap-0.5 font-mono text-xs">
                  {difference.lines.map((line, index) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: a diff line has no identity of its own, two identical lines are two real entries, and the list is regenerated whole on every read rather than reordered
                      key={`${line.kind}-${index}`}
                      className={
                        line.kind === "added"
                          ? "rounded bg-ok-bg px-1 text-ok"
                          : line.kind === "removed"
                            ? "rounded bg-bad-bg px-1 text-bad line-through"
                            : "px-1 text-ink-3"
                      }
                    >
                      {line.kind === "added"
                        ? "+ "
                        : line.kind === "removed"
                          ? "- "
                          : "  "}
                      {line.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
        {/*
         * **Inside the rail, not beside it** (P6-G27b). The row above is
         * `xl:flex-row` with exactly two children: a `min-w-0 flex-1`
         * content column and this `xl:w-80` rail. A third child takes its
         * intrinsic width and `min-w-0` lets the content column give up
         * every pixel of it, which is how the document's own heading
         * collapsed to nothing. The same defect P6-G11b shipped on the goal
         * page, twice more in one afternoon, and `two-column-rows.test.ts`
         * now refuses a fourth.
         */}
        <Attachments
          subjectType="document"
          subjectId={id}
          attachments={attachments}
          canEdit={level >= ACCESS_LEVELS.edit}
        />

        {level >= ACCESS_LEVELS.full ? (
          <DeleteControl
            subject="document"
            id={id}
            what="this document"
            returnTo="/"
          />
        ) : null}
      </div>
    </div>
  );
}
