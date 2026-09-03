import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
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
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const { id } = await params;

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
  const canEdit = level >= ACCESS_LEVELS.edit;
  const back = SUBJECT_HREF[document.subjectType]?.(document.subjectId) ?? null;

  return (
    <AppShellLayout>
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
                    Back to the {document.subjectType.replace("_", " ")}
                  </Link>
                ) : (
                  <span className="text-xs text-ink-3">
                    On a {document.subjectType.replace("_", " ")}
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
            </CardHeader>
            {document.state === "draft" ? (
              <CardBody>
                <p className="rounded-md bg-warn-bg px-2.5 py-1.5 text-xs text-warn">
                  Only you can see this. Nobody has been told about it, and it
                  is in nobody's feed. Publishing is what changes both.
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
              <h2 className="text-sm font-bold text-ink">History</h2>
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
                  Nothing yet. A version is written when you publish, because a
                  version is a thing you decided to show other people.
                </p>
              ) : (
                <ul className="flex flex-col gap-1" data-testid="doc-versions">
                  {document.versions.map((version) => (
                    <li
                      key={version.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="text-ink-2">
                        Version {version.version}
                      </span>
                      <span className="truncate text-ink-3">
                        {version.authorName} · {version.createdAt.slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {difference.to !== null && difference.from !== null ? (
                <div
                  className="flex flex-col gap-1"
                  data-testid="doc-difference"
                >
                  <p className="text-xs font-semibold text-ink-2">
                    What changed between version {difference.from} and{" "}
                    {difference.to}
                  </p>
                  <p className="text-xs text-ink-3">
                    {difference.added} added, {difference.removed} removed
                  </p>
                  {difference.truncated ? (
                    <p className="text-xs text-ink-3">
                      Too long to compare line by line, so this is the current
                      text rather than a difference.
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
        </div>
      </div>
    </AppShellLayout>
  );
}
