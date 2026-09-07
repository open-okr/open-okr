import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { ActionForm } from "../cycle/action-form.tsx";
import { createDocumentAction } from "./actions.ts";

/**
 * The documents on one subject (UIUX-PLAN.md §6 S-29, P5-T12).
 *
 * Mounted on whatever carries documents. The list it is given has already been
 * filtered by the query: somebody else's draft is not in it, and this component
 * could not show one if it wanted to.
 *
 * **A draft in this list is the reader's own.** It is marked, because the
 * difference between "nobody else can see this" and "everybody can" is the one
 * thing an author has to know before they walk away from it.
 */
export interface SubjectDocument {
  readonly id: string;
  readonly title: string;
  readonly state: "draft" | "published";
  readonly authorName: string;
  readonly versionCount: number;
  readonly updatedAt: string;
}

export function SubjectDocuments({
  subjectType,
  subjectId,
  documents,
  canEdit,
}: {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly documents: readonly SubjectDocument[];
  readonly canEdit: boolean;
}) {
  return (
    <Card>
      <CardHeader className="justify-between">
        <h2 className="text-sm font-bold text-ink">Documents</h2>
        <span className="text-xs text-ink-3" data-testid="document-count">
          {documents.length === 0
            ? "None yet"
            : `${documents.length} ${
                documents.length === 1 ? "document" : "documents"
              }`}
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {documents.length === 0 ? (
          <p className="rounded-md border border-line border-dashed px-3 py-4 text-center text-sm text-ink-3">
            Nothing written here yet. A document starts as a draft only you can
            see.
          </p>
        ) : (
          <ul
            className="flex flex-col divide-y divide-line"
            data-testid="documents"
          >
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center gap-2 py-2"
              >
                <div className="flex w-full min-w-0 flex-col gap-0.5 sm:w-auto sm:flex-1">
                  <Link
                    href={`/documents/${document.id}`}
                    className="truncate text-sm font-semibold text-ink hover:text-brand-text"
                  >
                    {document.title}
                  </Link>
                  <span className="truncate text-xs text-ink-3">
                    {document.authorName}
                    {document.versionCount > 0
                      ? ` · ${document.versionCount} version${
                          document.versionCount === 1 ? "" : "s"
                        }`
                      : ""}
                  </span>
                </div>
                <Chip tone={document.state === "draft" ? "warn" : "ok"} dot>
                  {document.state === "draft"
                    ? "Draft, yours only"
                    : "Published"}
                </Chip>
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <ActionForm
            action={createDocumentAction}
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="subjectType" value={subjectType} />
            <input type="hidden" name="subjectId" value={subjectId} />
            <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-ink-2">
              Start a document
              <input
                name="title"
                maxLength={300}
                placeholder="How we will win activation"
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand"
            >
              Start
            </button>
          </ActionForm>
        ) : null}
      </CardBody>
    </Card>
  );
}
