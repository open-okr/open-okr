"use server";

/**
 * A goal's own writes (P3-T04).
 *
 * The close form's retrospective is the compact editor's document
 * (docs/design/guided-inputs.md §4.7), so what was written bold stays bold.
 * Storage is always editor JSON, never Markdown.
 */
import { callAction, isBlankText, richTextFromPlainText } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { drafterFor } from "../../../lib/drafter";
import { formNumber } from "../../../lib/form-number";
import {
  refusalFields,
  refusedByField,
  refusedState,
} from "../../../lib/refusal";
import { readRichTextField } from "../../../lib/rich-text-form.ts";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { NO_ERROR, type WriteState } from "../../cycle/write-state.ts";

/** The translator `getTranslations` hands an action. */
type Translate = Awaited<ReturnType<typeof getTranslations>>["t"];

/**
 * What a refused write says, or null for a failure, which goes on to the
 * error page. By default each field the refusal names is shown under it
 * (guided-inputs §4.2): the forms here are `ActionForm`s.
 */
type Answer = (error: unknown, t: Translate) => WriteState | null;

const byField: Answer = (error, t) => refusedByField(error, t);

/** The fields `KeyResultUpdate` draws, by the names it gives them. */
const UPDATE_DRAWN = ["value", "confidence", "status", "note"] as const;

async function run(
  goalId: string,
  fn: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
  answer: Answer = byField,
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
  revalidatePath(`/goals/${goalId}`);
  revalidatePath("/cycle");
  // The explorer and the canvas read the same numbers, and S-14's acceptance
  // criterion is that a value recorded here moves both (P3-T10).
  revalidatePath("/goals");
  return NO_ERROR;
}

export async function editGoal(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const contributionStatement = String(
    formData.get("contributionStatement") ?? "",
  ).trim();
  const weight = formNumber(formData, "weight");

  if (title === "") {
    const { t } = await getTranslations();
    return {
      error: null,
      fields: { title: t("goals.detail.actions.objectiveNeedsATitle") },
    };
  }

  return run(id, (context) =>
    callAction(context, "goals.update", {
      id,
      title,
      contributionStatement:
        contributionStatement === "" ? null : contributionStatement,
      ...(Number.isFinite(weight) ? { weight } : {}),
    }),
  );
}

export async function closeGoal(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  const retrospective = readRichTextField(formData, "retrospective");

  if (retrospective.state !== "document") {
    // The same refusal the action makes, said before the round trip so the
    // person reads it beside the field they left empty.
    const { t } = await getTranslations();
    return {
      error: null,
      fields: {
        retrospective:
          retrospective.state === "malformed"
            ? t("goals.detail.actions.retrospectiveUnreadable")
            : t("goals.detail.actions.closingNeedsARetrospective"),
      },
    };
  }

  return run(
    id,
    (context) =>
      callAction(context, "goals.close", {
        id,
        successStatus: String(formData.get("successStatus") ?? "achieved") as
          | "achieved"
          | "missed",
        closeDecision: String(formData.get("closeDecision") ?? "keep") as
          | "achieved"
          | "keep"
          | "modify"
          | "defer"
          | "abandon",
        closeReason:
          String(formData.get("closeReason") ?? "").trim() || undefined,
        retrospectiveBody: retrospective.document,
      }),
    // The form calls the action's `retrospectiveBody` the retrospective.
    (error, t) =>
      refusedByField(error, t, { retrospectiveBody: "retrospective" }),
  );
}

export async function reopenGoal(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  return run(id, (context) => callAction(context, "goals.reopen", { id }));
}

export async function reassignRole(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  return run(id, (context) =>
    callAction(context, "goals.reassignRole", {
      id,
      role: String(formData.get("role") ?? "champion") as
        | "champion"
        | "reviewer",
      // "" is "Nobody", which takes a reviewer off (P9-T04).
      memberId: String(formData.get("memberId") ?? "") || null,
    }),
  );
}

/**
 * A key result's value, and its confidence as a check-in (S-14, P3-T10,
 * P9-T08b).
 *
 * The value goes through `goals.recordValue`, so the value history, the
 * cascade and the goal's health all follow from it. §5.2 measures structure,
 * so the alignment score deliberately does not move.
 *
 * **A changed confidence is a check-in**, because METHOD.md §3.2 puts
 * confidence there, with a sentence and a status. Until P9-T08b this page
 * offered a confidence slider its action ignored, for exactly that reason:
 * a number that could change with nobody saying why. Now the change carries
 * the line and the status the reader gave, and is published through
 * `goals.publishDraftedCheckIn`, which also moves the objective's next
 * check-in on (§7.2). The check-in's own confidence, the objective's, is what
 * its last check-in said, because only one key result's moved here; with no
 * check-in yet, it is the one number the reader gave.
 */
export async function updateKeyResult(input: {
  readonly goalId: string;
  readonly keyResultId: string;
  /** Absent when the value was left alone. */
  readonly value?: number;
  readonly confidence?: number;
  readonly status?: "on_track" | "caution" | "off_track" | null;
  readonly note?: string;
}): Promise<WriteState> {
  const { t } = await getTranslations();
  if (input.value !== undefined && !Number.isFinite(input.value)) {
    return {
      error: null,
      fields: { value: t("cycle.actions.valueHasToBeANumber") },
    };
  }
  // The row draws its own fields, so a refusal names only the ones it shows,
  // by the names it gives them, and says the rest as its sentence.
  const answer: Answer = (error, translate) => {
    const refused = refusedState(error, translate, UPDATE_DRAWN, {
      "values.0.value": "value",
      "values.0.confidence": "confidence",
      narrative: "note",
    });
    return refused === null
      ? null
      : {
          error: refused.error ?? null,
          ...(refused.fields ? { fields: refused.fields } : {}),
        };
  };
  if (input.confidence === undefined) {
    if (input.value === undefined) {
      return NO_ERROR;
    }
    const value = input.value;
    return run(
      input.goalId,
      async (context) => {
        await callAction(context, "goals.recordValue", {
          id: input.keyResultId,
          value,
        });
      },
      answer,
    );
  }
  if (!input.status) {
    return {
      error: null,
      fields: { status: t("goals.detail.actions.chooseAStatus") },
    };
  }
  if (isBlankText(input.note ?? "")) {
    return {
      error: null,
      fields: { note: t("goals.detail.actions.confidenceNeedsALine") },
    };
  }
  const status = input.status;
  const confidence = input.confidence;
  return run(
    input.goalId,
    async (context) => {
      const { checkIns } = await callAction(context, "goals.checkIns", {
        goalId: input.goalId,
        includeDrafts: false,
      });
      await callAction(context, "goals.publishDraftedCheckIn", {
        goalId: input.goalId,
        status,
        confidence: checkIns[0]?.confidence ?? confidence,
        narrative: richTextFromPlainText(input.note ?? ""),
        values: [
          {
            keyResultId: input.keyResultId,
            confidence,
            ...(input.value === undefined ? {} : { value: input.value }),
          },
        ],
      });
      // A check-in moves an obligation and the walker as well as the goal.
      revalidatePath("/review");
      revalidatePath("/check-in");
    },
    answer,
  );
}

/**
 * The rewrite assist (P4-T06c).
 *
 * Reads and returns; it saves nothing, which is the whole point of an assist.
 * `drafterFor` is shared with the admin run controls so a workspace resolves
 * one provider, one model and one cap wherever an agent speaks.
 *
 * Null means no suggestion: the provider is off, the host has no rewrite
 * capability, or the model produced nothing the schema accepted. The strip
 * explains that state rather than showing an error.
 */
export async function rewriteKeyResultAction(
  keyResultId: string,
  ruleId: string,
) {
  const { session, workspace } = await requireWorkspace();
  const drafter = await drafterFor(
    workspace.workspaceId,
    "balanced",
    session.user.id,
  );
  return callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
      ...(drafter ? { drafter } : {}),
    },
    "goals.rewriteKeyResult",
    { keyResultId, ruleId },
  );
}

/**
 * Applying a suggested rewrite (P4-T06c).
 *
 * A separate call from the suggestion on purpose: the assist reads, this
 * writes, and nothing reaches the key result until a champion has seen the
 * words and pressed the button. The write is the ordinary edit path, so
 * P4-T02a re-evaluates the goal in the same transaction and the verdict on the
 * screen updates itself. No second quality write exists here to disagree with.
 */
export async function applyRewrite(
  goalId: string,
  keyResultId: string,
  title: string,
): Promise<WriteState> {
  return run(
    goalId,
    (context) =>
      callAction(context, "goals.updateKeyResult", { id: keyResultId, title }),
    // The coach strip draws no field, so whatever is refused is its sentence.
    (error, t) => {
      const refusal = refusalFields(error, t);
      return refusal === null ? null : { error: refusal.message };
    },
  );
}
