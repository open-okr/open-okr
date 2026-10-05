"use server";

/**
 * The OKR tree's one read and its writes, for the client cache (P9-T06c),
 * and the drawer's read of what the tree does not carry (P9-T08a).
 *
 * **An allow-list, as the delete path has.** A server action takes whatever
 * the browser sends, so the switch below over thirteen named writes is what stops
 * this becoming a way to call any action in the registry. Each write goes
 * through the action every other surface uses, so the cache can do nothing
 * the API cannot and is refused the same way.
 *
 * **A refusal comes back as a value rather than a throw**, with the server's
 * sentence and, for a conflict, what is stored now and who changed it, so
 * the hook can put the tree back and say why without guessing.
 */

import {
  callAction,
  excerptRichText,
  isBlankText,
  OperationError,
  richTextFromPlainText,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../auth";
import { getTranslations } from "../translations";
import { requireWorkspace } from "../workspace";
import type {
  GoalFields,
  KeyResultFields,
  OkrGoal,
  OkrScope,
  OkrTree,
} from "./cache.ts";

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/** One cycle's tree, closed objectives included; a filter decides what shows. */
export async function readOkrTree(input: {
  readonly cycleId: string;
  readonly scope: OkrScope;
}): Promise<OkrTree> {
  return callAction(await context(), "goals.tree", {
    cycleId: input.cycleId,
    scope: input.scope,
    includeClosed: true,
  });
}

/**
 * What the drawer shows that the tree does not carry (P9-T08a): the
 * check-ins, each key result's values and target changes, and the
 * objective's neighbours in the alignment.
 *
 * Four reads the registry already had, each asking its own access, made
 * together so the drawer's tabs land at once. The narrative is cut to an
 * excerpt here, as plain text, so the browser never renders stored editor
 * JSON it was not given a renderer for.
 */
export interface OkrDetail {
  readonly relations: Awaited<ReturnType<typeof callAction<"goals.relations">>>;
  readonly checkIns: readonly {
    readonly id: string;
    readonly author: string;
    /** The day it was published, as stored. */
    readonly on: string;
    readonly status: "on_track" | "caution" | "off_track" | null;
    readonly confidence: number | null;
    readonly narrative: string;
  }[];
  readonly keyResults: Readonly<
    Record<
      string,
      {
        readonly values: readonly {
          readonly id: string;
          readonly value: number;
          readonly at: string;
        }[];
        readonly targets: Awaited<
          ReturnType<typeof callAction<"goals.targetHistory">>
        >["changes"];
      }
    >
  >;
}

/** The newest check-ins and values the drawer lists; the page has the rest. */
const DETAIL_CHECK_INS = 10;
const DETAIL_VALUES = 12;
/** More key results than any objective should carry; the rest are not read. */
const DETAIL_KEY_RESULTS = 25;

export async function readOkrDetail(input: {
  readonly goalId: string;
  readonly keyResultIds: readonly string[];
}): Promise<OkrDetail> {
  const ctx = await context();
  const ids = input.keyResultIds.slice(0, DETAIL_KEY_RESULTS);
  const [relations, timeline, histories] = await Promise.all([
    callAction(ctx, "goals.relations", { id: input.goalId }),
    callAction(ctx, "goals.checkIns", {
      goalId: input.goalId,
      includeDrafts: false,
    }),
    Promise.all(
      ids.map(async (id) => {
        const [values, targets] = await Promise.all([
          callAction(ctx, "goals.keyResultHistory", {
            keyResultId: id,
            limit: DETAIL_VALUES,
          }),
          callAction(ctx, "goals.targetHistory", { id }),
        ]);
        return [
          id,
          {
            values: values.values.map((entry) => ({
              id: entry.id,
              value: entry.value,
              at: entry.at,
            })),
            // Newest first, as the values are.
            targets: [...targets.changes].reverse(),
          },
        ] as const;
      }),
    ),
  ]);
  return {
    relations,
    checkIns: timeline.checkIns.slice(0, DETAIL_CHECK_INS).map((checkIn) => ({
      id: checkIn.id,
      author: checkIn.author.name,
      on: (checkIn.publishedAt ?? "").slice(0, 10),
      status: checkIn.status,
      confidence: checkIn.confidence,
      narrative: checkIn.narrative
        ? excerptRichText(checkIn.narrative as never, 280)
        : "",
    })),
    keyResults: Object.fromEntries(histories),
  };
}

/** Boolean for a milestone's done (P9-T12c-a), compared as it is. */
type Readable = string | number | boolean | null;

export type OkrMutation =
  | {
      readonly kind: "patchGoal";
      readonly id: string;
      readonly set: GoalFields;
      readonly read: Readonly<Record<string, Readable>>;
    }
  | {
      readonly kind: "patchKeyResult";
      readonly id: string;
      readonly set: Omit<KeyResultFields, "currentValue" | "targetValue">;
      readonly read: Readonly<Record<string, Readable>>;
    }
  | {
      readonly kind: "recordValue";
      readonly id: string;
      readonly value: number;
    }
  | {
      readonly kind: "changeTarget";
      readonly id: string;
      readonly targetValue: number;
      readonly reason?: string;
    }
  | { readonly kind: "removeKeyResult"; readonly id: string }
  | { readonly kind: "restoreKeyResult"; readonly id: string }
  | {
      readonly kind: "placeGoal";
      readonly id: string;
      readonly afterId: string | null;
    }
  | {
      readonly kind: "placeKeyResult";
      readonly id: string;
      readonly afterId: string | null;
    }
  | { readonly kind: "deleteGoal"; readonly id: string }
  | { readonly kind: "restoreGoal"; readonly id: string }
  /**
   * A waiting draft published by its owner, or approved by its reviewer
   * (METHOD.md §2.9, P9-T13-b-b). The server says where it goes.
   */
  | { readonly kind: "publishDraft"; readonly id: string }
  /**
   * §2.9's stop, closed as abandoned with a one-line reason, and its undo,
   * which reopens it (P9-T13-c-a).
   */
  | { readonly kind: "stopGoal"; readonly id: string; readonly reason: string }
  | { readonly kind: "reopenGoal"; readonly id: string }
  /** To another space, with everything that hangs from it (P9-T13a). */
  | {
      readonly kind: "moveToSpace";
      readonly id: string;
      readonly spaceId: string;
    }
  | { readonly kind: "approveDraft"; readonly id: string }
  | {
      /** Committed or aspirational, with why (METHOD.md §2.8, P9-T11b-a). */
      readonly kind: "setKind";
      readonly id: string;
      readonly okrKind: "committed" | "aspirational";
      readonly reason?: string;
    }
  | {
      /**
       * An objective hung under another parent from the diagram (P9-T10b).
       * `from` is where it hung before, so the undo can put it back; an undo
       * is marked so it offers no undo of its own.
       */
      readonly kind: "reparent";
      readonly id: string;
      readonly parentGoalId: string | null;
      readonly parentKeyResultId: string | null;
      readonly from: {
        readonly parentGoalId: string | null;
        readonly parentKeyResultId: string | null;
      };
      readonly undo?: boolean;
    }
  | {
      /**
       * A check-in from the drawer (P9-T08b). `id` is the objective's, so a
       * refusal is shown where the other changes to it are.
       */
      readonly kind: "checkIn";
      readonly id: string;
      readonly status: "on_track" | "caution" | "off_track";
      /** §3.2's own scale, nought to one. */
      readonly confidence: number;
      readonly narrative: string;
      readonly values: readonly {
        readonly keyResultId: string;
        readonly value?: number;
        readonly confidence?: number;
        /** A milestone done with this check-in (METHOD.md §2.10). */
        readonly done?: boolean;
      }[];
    };

export interface OkrConflict {
  readonly current: Readonly<Record<string, unknown>>;
  readonly changedBy: string | null;
  readonly changedAt: string | null;
}

export type OkrOutcome =
  | {
      readonly ok: true;
      /** The recomputed node, when the write returns one; else re-read. */
      readonly goal: OkrGoal | null;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly conflict?: OkrConflict;
    };

async function write(mutation: OkrMutation): Promise<OkrGoal | null> {
  const ctx = await context();
  switch (mutation.kind) {
    case "patchGoal":
      return (
        await callAction(ctx, "goals.patch", {
          id: mutation.id,
          set: mutation.set,
          read: mutation.read,
        })
      ).goal;
    case "patchKeyResult":
      return (
        await callAction(ctx, "goals.patchKeyResult", {
          id: mutation.id,
          set: mutation.set,
          read: mutation.read,
        })
      ).goal;
    case "changeTarget":
      return (
        await callAction(ctx, "goals.changeTarget", {
          id: mutation.id,
          targetValue: mutation.targetValue,
          ...(mutation.reason ? { reason: mutation.reason } : {}),
        })
      ).goal;
    case "restoreKeyResult":
      return (
        await callAction(ctx, "goals.restoreKeyResult", { id: mutation.id })
      ).goal;
    case "recordValue":
      await callAction(ctx, "goals.recordValue", {
        id: mutation.id,
        value: mutation.value,
      });
      return null;
    case "removeKeyResult":
      await callAction(ctx, "goals.removeKeyResult", { id: mutation.id });
      return null;
    case "placeKeyResult":
      return (
        await callAction(ctx, "goals.placeKeyResult", {
          id: mutation.id,
          afterId: mutation.afterId,
        })
      ).goal;
    case "placeGoal":
      await callAction(ctx, "goals.place", {
        id: mutation.id,
        afterId: mutation.afterId,
      });
      return null;
    case "deleteGoal":
      await callAction(ctx, "goals.delete", { id: mutation.id });
      return null;
    case "restoreGoal":
      await callAction(ctx, "goals.restore", { id: mutation.id });
      return null;
    case "setKind":
      return (
        await callAction(ctx, "goals.setKind", {
          id: mutation.id,
          kind: mutation.okrKind,
          ...(mutation.reason ? { reason: mutation.reason } : {}),
        })
      ).goal;
    case "stopGoal":
      await callAction(ctx, "goals.stop", {
        id: mutation.id,
        reason: mutation.reason,
      });
      return null;
    case "reopenGoal":
      await callAction(ctx, "goals.reopen", { id: mutation.id });
      return null;
    case "moveToSpace":
      return (
        await callAction(ctx, "goals.moveToSpace", {
          id: mutation.id,
          spaceId: mutation.spaceId,
        })
      ).goal;
    case "publishDraft":
      return (await callAction(ctx, "goals.publishDraft", { id: mutation.id }))
        .goal;
    case "approveDraft":
      return (await callAction(ctx, "goals.approveDraft", { id: mutation.id }))
        .goal;
    case "reparent":
      // `goals.update` keeps the one-parent rule and refuses a loop, so the
      // diagram can offer any card as a parent and let the server say no.
      await callAction(ctx, "goals.update", {
        id: mutation.id,
        ...(mutation.parentKeyResultId
          ? { parentKeyResultId: mutation.parentKeyResultId }
          : { parentGoalId: mutation.parentGoalId }),
      });
      return null;
    case "checkIn":
      // Opened and published in one action, so a drawer closed half way
      // leaves no draft behind (METHOD.md §7.2).
      await callAction(ctx, "goals.publishDraftedCheckIn", {
        goalId: mutation.id,
        status: mutation.status,
        confidence: mutation.confidence,
        narrative: richTextFromPlainText(mutation.narrative),
        values: [...mutation.values],
      });
      return null;
  }
}

export async function runOkrMutation(
  mutation: OkrMutation,
): Promise<OkrOutcome> {
  if (mutation.kind === "checkIn" && isBlankText(mutation.narrative)) {
    // The action stores an empty narrative as readily as a full one, so the
    // rule a check-in needs is said here, before the round trip, in the
    // composer's own words.
    const { t } = await getTranslations();
    return { ok: false, error: t("checkIn.actions.needsANarrative") };
  }
  try {
    const goal = await write(mutation);
    // Every screen that names an objective or a value counts on the next
    // render being fresh: the Work Map, the dashboard, the goal page. A value
    // typed here is recorded as history through `goals.recordValue`, the same
    // path a check-in takes, so the history has no hole where the table was
    // the quicker door (P8-G12).
    revalidatePath("/", "layout");
    return { ok: true, goal };
  } catch (error) {
    if (error instanceof OperationError) {
      if (error.code === "conflict" && error.details) {
        const details = error.details as Partial<OkrConflict>;
        return {
          ok: false,
          error: error.message,
          conflict: {
            current: details.current ?? {},
            changedBy: details.changedBy ?? null,
            changedAt: details.changedAt ?? null,
          },
        };
      }
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
