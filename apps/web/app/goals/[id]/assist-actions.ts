"use server";

/**
 * The goal page's assists (completeness review M-09).
 *
 * Three drafts and one write. `goals.draftRetrospective` was built at P4-T15c
 * for the close form and nothing called it; `comments.summarise` and
 * `goals.decomposeKeyResult` are §2.4's two assists that no task built. The
 * drafts read and return. The write creates what a person kept from a
 * decomposition, through the ordinary `initiatives.create` and `tasks.create`,
 * as that person: an initiative in a space they may not create work in is
 * refused there, by the space's own access, and named here.
 */
import {
  callAction,
  OperationError,
  richTextFromPlainText,
  richTextSchema,
} from "@openokr/core";
import { isBlankDocument } from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { assistContext } from "../../../lib/assists";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { DESCRIPTION_MAX_CHARACTERS } from "./decompose-limits.ts";

/**
 * The closing retrospective drafted from the goal's own check-ins, or null.
 *
 * With the draft as a document too, since the field it goes into is the
 * compact editor and `richTextFromPlainText` runs on the server only.
 */
export async function draftRetrospectiveAction(goalId: string) {
  const drafted = await callAction(
    await assistContext(),
    "goals.draftRetrospective",
    { goalId },
  );
  return drafted === null
    ? null
    : {
        narrative: drafted.narrative,
        document: richTextFromPlainText(drafted.narrative),
      };
}

/** The discussion on this goal, summarised, or null. Writes nothing. */
export async function summariseThreadAction(goalId: string) {
  return callAction(await assistContext(), "comments.summarise", {
    subjectType: "goal",
    subjectId: goalId,
  });
}

/**
 * Initiatives and tasks drafted for one key result, or null.
 *
 * On the `deep` tier, which AI-NATIVE-PLAN §3.4 gives decomposition.
 */
export async function decomposeKeyResultAction(
  goalId: string,
  keyResultId: string,
) {
  const drafted = await callAction(
    await assistContext("deep"),
    "goals.decomposeKeyResult",
    { goalId, keyResultId },
  );
  // Each description as a document, for the compact editor it is edited in.
  return drafted === null
    ? null
    : {
        ...drafted,
        initiatives: drafted.initiatives.map((initiative) => ({
          ...initiative,
          description: richTextFromPlainText(initiative.description),
        })),
      };
}

/** What the person kept from a decomposition, edited, to be created. */
export interface KeptInitiative {
  readonly title: string;
  /** The editor's document, checked here before anything is written. */
  readonly description: unknown;
  readonly tasks: readonly string[];
}

/** The most a single press may create, matching what the draft may hold. */
const MOST_INITIATIVES = 4;
const MOST_TASKS = 6;

/**
 * Creates what the person kept, one Operation per row.
 *
 * **Each row is its own write**, the same arrangement the drafting assist on
 * the cycle screen uses for key results: an initiative the space refuses does
 * not take the others with it, and a task that fails leaves its initiative
 * standing to hold it. Every refusal is named rather than swallowed.
 *
 * The initiative is owned by the person pressing the button, because owning
 * the work is something a person accepts and a draft cannot accept it for
 * them. The tasks are left unassigned for the same reason.
 */
export async function createDecomposedWorkAction(input: {
  readonly goalId: string;
  readonly keyResultId: string;
  readonly spaceId: string;
  readonly initiatives: readonly KeptInitiative[];
}): Promise<{
  readonly initiatives: number;
  readonly tasks: number;
  readonly refused: readonly string[];
}> {
  const { t } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const reason = (error: unknown) =>
    error instanceof OperationError
      ? error.message
      : t("goals.detail.decompose.somethingWentWrong");

  let initiatives = 0;
  let tasks = 0;
  const refused: string[] = [];
  for (const kept of input.initiatives.slice(0, MOST_INITIATIVES)) {
    const title = kept.title.trim();
    if (title === "") {
      continue;
    }
    // The panel's own cap, held here rather than on `initiatives.create`
    // (decompose-limits.ts says why), with the schema every rich text write
    // uses, so a description that is not a document is refused too.
    const description = richTextSchema({
      maxCharacters: DESCRIPTION_MAX_CHARACTERS,
    }).safeParse(kept.description);
    if (!description.success) {
      refused.push(
        t("goals.detail.decompose.refused", {
          title,
          reason: description.error.issues[0]?.message ?? "",
        }),
      );
      continue;
    }
    let initiativeId: string;
    try {
      initiativeId = (
        await callAction(context, "initiatives.create", {
          spaceId: input.spaceId,
          title,
          ...(isBlankDocument(description.data)
            ? {}
            : { description: description.data }),
          ownerId: workspace.memberId,
          keyResultIds: [input.keyResultId],
        })
      ).id;
      initiatives += 1;
    } catch (error) {
      refused.push(
        t("goals.detail.decompose.refused", { title, reason: reason(error) }),
      );
      continue;
    }
    for (const task of kept.tasks.slice(0, MOST_TASKS)) {
      const named = task.trim();
      if (named === "") {
        continue;
      }
      try {
        await callAction(context, "tasks.create", {
          spaceId: input.spaceId,
          title: named,
          initiativeId,
          keyResultId: input.keyResultId,
        });
        tasks += 1;
      } catch (error) {
        refused.push(
          t("goals.detail.decompose.refused", {
            title: named,
            reason: reason(error),
          }),
        );
      }
    }
  }

  revalidatePath(`/goals/${input.goalId}`);
  revalidatePath("/initiatives");
  revalidatePath("/board");
  return { initiatives, tasks, refused };
}
