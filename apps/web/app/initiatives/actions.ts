"use server";

/**
 * The initiative screen's writes (S-26, P5-T10b).
 *
 * Every one is a thin wrapper over a registry action, which is the whole point:
 * the refusals a reader sees here are written in `packages/core`, so the browser
 * and an agent calling the same tool are told the same thing.
 *
 * **Nothing here writes progress.** `initiatives.update` has no such field, and
 * this file cannot invent one. The work-layer design's §1 is the reason: an
 * initiative's progress is the share of its own tasks that are done (P5-T11),
 * and it never becomes a key result's progress.
 */
import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { refusedByField, refusedSentence } from "../../lib/refusal";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

/**
 * What a refused write says (guided-inputs §4.2): one sentence by default,
 * for the row's selects and the unlink button, which draw no field to put a
 * message under; under each field it names for the two forms. A schema's
 * refusal too, which used to reach the error page. Null for a failure.
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
  paths: readonly string[] = ["/initiatives"],
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

const CAPACITIES = ["fits", "tight", "exceeds"] as const;
const STATUSES = ["planned", "active", "done", "dropped"] as const;

type Capacity = (typeof CAPACITIES)[number];
type Status = (typeof STATUSES)[number];

const asCapacity = (value: string): Capacity | null =>
  CAPACITIES.find((one) => one === value) ?? null;

const asStatus = (value: string): Status | null =>
  STATUSES.find((one) => one === value) ?? null;

export async function createInitiativeAction(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const title = String(formData.get("title") ?? "").trim();
  const spaceId = String(formData.get("spaceId") ?? "");
  const ownerId = String(formData.get("ownerId") ?? "");
  const startsOn = String(formData.get("startsOn") ?? "").trim();
  const endsOn = String(formData.get("endsOn") ?? "").trim();
  const keyResultId = String(formData.get("keyResultId") ?? "").trim();
  const { t } = await getTranslations();

  if (title === "") {
    return {
      error: null,
      fields: { title: t("initiatives.actions.initiativeNeedsATitle") },
    };
  }
  if (spaceId === "" || ownerId === "") {
    // Under whichever of the two is missing, the space first.
    return {
      error: null,
      fields: {
        [spaceId === "" ? "spaceId" : "ownerId"]: t(
          "initiatives.actions.initiativeNeedsASpaceAndOwner",
        ),
      },
    };
  }

  return run(
    (context) =>
      callAction(context, "initiatives.create", {
        spaceId,
        title,
        ownerId,
        ...(startsOn === "" ? {} : { startsOn }),
        ...(endsOn === "" ? {} : { endsOn }),
        ...(keyResultId === "" ? {} : { keyResultIds: [keyResultId] }),
      }),
    undefined,
    // The form names the one key result it links by itself.
    (error, t) =>
      refusedByField(error, t, {
        keyResultIds: "keyResultId",
        "keyResultIds.0": "keyResultId",
      }),
  );
}

/**
 * One field at a time, from the row itself.
 *
 * S-26 asks for inline editing, and the smallest honest version of that is a
 * select that submits on change. A refusal comes back as a sentence rather than
 * a reverted control, so a reader who lacks edit access learns why.
 */
export async function setStatusAction(
  id: string,
  status: string,
): Promise<WriteState> {
  const value = asStatus(status);
  if (!value) {
    const { t } = await getTranslations();
    return { error: t("initiatives.actions.notAStatus") };
  }
  return run(
    (context) =>
      callAction(context, "initiatives.update", { id, status: value }),
    ["/initiatives", `/initiatives/${id}`],
  );
}

export async function setCapacityAction(
  id: string,
  capacity: string,
): Promise<WriteState> {
  // The empty string is "nobody has judged it", which is a different fact from
  // `fits` and the one gate five reads differently.
  const value = capacity === "" ? null : asCapacity(capacity);
  if (capacity !== "" && !value) {
    const { t } = await getTranslations();
    return { error: t("initiatives.actions.notACapacityVerdict") };
  }
  return run(
    (context) =>
      callAction(context, "initiatives.update", { id, capacity: value }),
    ["/initiatives", `/initiatives/${id}`, "/cycle"],
  );
}

export async function linkKeyResultAction(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  const keyResultId = String(formData.get("keyResultId") ?? "");
  if (id === "" || keyResultId === "") {
    const { t } = await getTranslations();
    return {
      error: null,
      fields: { keyResultId: t("initiatives.actions.pickTheKeyResult") },
    };
  }
  return run(
    (context) =>
      callAction(context, "initiatives.linkKeyResult", { id, keyResultId }),
    ["/initiatives", `/initiatives/${id}`, "/cycle"],
    refusedByField,
  );
}

export async function unlinkKeyResultAction(
  id: string,
  keyResultId: string,
): Promise<WriteState> {
  return run(
    (context) =>
      callAction(context, "initiatives.unlinkKeyResult", { id, keyResultId }),
    ["/initiatives", `/initiatives/${id}`, "/cycle"],
  );
}
