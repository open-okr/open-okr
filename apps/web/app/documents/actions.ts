"use server";

/**
 * The document surface's writes (S-29, P5-T12).
 *
 * Thin wrappers over the registry, so the sentence a reader sees when a write is
 * refused is the one `packages/core` wrote. Nothing here decides who may read a
 * draft: that is a clause in the query, and this file could not widen it if it
 * tried.
 */
import {
  callAction,
  OperationError,
  type RichTextDocument,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
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

async function run(
  fn: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
  paths: readonly string[],
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  try {
    await fn({
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
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

  if (!kind || subjectId === "") {
    return { error: "A document hangs off something. Which?" };
  }
  if (title === "") {
    return { error: "A document needs a title. What is it about?" };
  }

  return run(
    (context) =>
      callAction(context, "documents.create", {
        subjectType: kind,
        subjectId,
        title,
      }),
    pathsFor(subjectType, subjectId),
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
