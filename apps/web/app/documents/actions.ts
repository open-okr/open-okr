"use server";

/**
 * The document surface's writes (S-29, P5-T12).
 *
 * Thin wrappers over the registry, so the sentence a reader sees when a write is
 * refused is the one `packages/core` wrote. Nothing here decides who may read a
 * draft: that is a clause in the query, and this file could not widen it if it
 * tried.
 */
import { callAction, type RichTextDocument } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { refusedByField, refusedSentence } from "../../lib/refusal";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

const SUBJECTS = [
  "space",
  "goal",
  "key_result",
  "initiative",
  "cycle",
  "session",
] as const;

/**
 * What a refused write says (guided-inputs §4.2): under the title for the
 * new document form, one sentence for the editor's save and publish, which
 * write the whole document. A schema's refusal too, which used to reach the
 * error page.
 */
type Answer = (
  error: unknown,
  t: Awaited<ReturnType<typeof getTranslations>>["t"],
) => WriteState | null;

async function run(
  fn: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
  paths: readonly string[],
  answer: Answer = refusedSentence,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  try {
    await fn({
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    });
  } catch (error) {
    const refused = answer(error, (await getTranslations()).t);
    if (refused === null) {
      throw error;
    }
    return refused;
  }
  for (const path of paths) {
    revalidatePath(path);
  }
  return NO_ERROR;
}

/** Where a change to a document on this subject has to be re-read. */
const pathsFor = (subjectType: string, subjectId: string, id?: string) => [
  ...(subjectType === "goal" ? [`/goals/${subjectId}`] : []),
  ...(subjectType === "space" ? [`/spaces/${subjectId}`] : []),
  ...(subjectType === "initiative" ? [`/initiatives/${subjectId}`] : []),
  ...(subjectType === "session" ? [`/session/${subjectId}`] : []),
  ...(subjectType === "cycle" ? ["/cycle"] : []),
  ...(id ? [`/documents/${id}`] : []),
];

export async function createDocumentAction(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const subjectType = String(formData.get("subjectType") ?? "");
  const subjectId = String(formData.get("subjectId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const kind = SUBJECTS.find((one) => one === subjectType);
  const { t } = await getTranslations();

  if (!kind || subjectId === "") {
    return { error: t("documents.actions.documentHangsOffSomething") };
  }
  if (title === "") {
    return {
      error: null,
      fields: { title: t("documents.actions.documentNeedsATitle") },
    };
  }

  return run(
    (context) =>
      callAction(context, "documents.create", {
        subjectType: kind,
        subjectId,
        title,
      }),
    pathsFor(subjectType, subjectId),
    refusedByField,
  );
}

export async function updateDocumentAction(
  id: string,
  subjectType: string,
  subjectId: string,
  // Typed rather than `unknown`: the editor hands back editor JSON, and the
  // action validates it again at the boundary. A `unknown` here would have to
  // be cast at the call, which is the cast this type exists to avoid.
  body: RichTextDocument | null,
): Promise<WriteState> {
  return run(
    (context) => callAction(context, "documents.update", { id, body }),
    pathsFor(subjectType, subjectId, id),
  );
}

export async function publishDocumentAction(
  id: string,
  subjectType: string,
  subjectId: string,
): Promise<WriteState> {
  return run(
    (context) => callAction(context, "documents.publish", { id }),
    pathsFor(subjectType, subjectId, id),
  );
}
