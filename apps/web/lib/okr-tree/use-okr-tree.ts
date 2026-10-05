"use client";

/**
 * One cache for the OKR list, the drawer and the diagram (P9-T06c,
 * docs/design/p9-t00-okr-writing.md §6).
 *
 * **`useOkrTree`** reads one cycle's tree into TanStack Query under
 * `["okr-tree", cycleId, scope]`, seeded by the server's own render so the
 * first paint costs no second request. The tree is kept in memory only: see
 * `persistable` in the query provider for why.
 *
 * **`useOkrMutation`** is the one way to change it. The cache is changed at
 * once, the write goes to the server, and then one of three things happens:
 * the server's recomputed node replaces the guess; a refusal puts the tree
 * back and says why in the server's own sentence; or a conflict puts the tree
 * back and offers keep-mine or take-theirs, because somebody else changed the
 * field first and neither value should win silently.
 *
 * **`useOkrDetail`** is the drawer's read of what the tree does not carry,
 * read again after every write so its history is never behind the row.
 *
 * **`useOkrLive`** keeps it fresh. Another tab in this browser hears a change
 * over a `BroadcastChannel`, because the live feed deliberately does not ping
 * a member about their own write. Another member's change arrives on the
 * workspace feed's stream, coalesced the way `FeedLive` coalesces it.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  useToast,
  useTranslations,
} from "@openokr/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type OkrConflict,
  type OkrDetail,
  type OkrMutation,
  type OkrOutcome,
  readOkrDetail,
  readOkrTree,
  runOkrMutation,
} from "./actions.ts";
import {
  kindIn,
  mergeGoal,
  OKR_DETAIL_ALL,
  type OkrGoal,
  type OkrScope,
  type OkrTree,
  okrCycleKey,
  okrDetailKey,
  okrTreeKey,
  patchGoalIn,
  patchKeyResultIn,
  placeGoalIn,
  placeKeyResultIn,
  reparentIn,
  withoutGoal,
  withoutKeyResult,
} from "./cache.ts";

/** The channel tabs of one browser tell each other about a write on. */
const OKR_CHANNEL = "openokr-okr-tree";

/** How long a burst of other members' writes is gathered into one re-read. */
const LIVE_WINDOW_MS = 1_500;

export function useOkrTree(input: {
  readonly cycleId: string;
  readonly scope: OkrScope;
  /** The server's render of the same tree, and when it was read. */
  readonly initial: OkrTree;
  readonly initialAt: number;
}): OkrTree {
  const queryClient = useQueryClient();
  const key = okrTreeKey(input.cycleId, input.scope);
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => readOkrTree({ cycleId: input.cycleId, scope: input.scope }),
    initialData: input.initial,
    initialDataUpdatedAt: input.initialAt,
    meta: { persist: false },
  });

  // A server render after a navigation or a refresh is newer than what the
  // cache holds, and `initialData` is read only once, so it is put in here.
  const seen = useRef(input.initialAt);
  useEffect(() => {
    if (input.initialAt > seen.current) {
      seen.current = input.initialAt;
      queryClient.setQueryData(key, input.initial, {
        updatedAt: input.initialAt,
      });
    }
  }, [input.initial, input.initialAt, key, queryClient]);

  return data;
}

/** What a mutation does to the cached tree before the server answers. */
function optimistic(tree: OkrTree, mutation: OkrMutation): OkrTree {
  switch (mutation.kind) {
    case "patchGoal":
      return patchGoalIn(tree, mutation.id, mutation.set);
    case "patchKeyResult":
      return patchKeyResultIn(tree, mutation.id, mutation.set);
    case "recordValue":
      return patchKeyResultIn(tree, mutation.id, {
        currentValue: mutation.value,
      });
    case "changeTarget":
      return patchKeyResultIn(tree, mutation.id, {
        targetValue: mutation.targetValue,
      });
    case "removeKeyResult":
      return withoutKeyResult(tree, mutation.id);
    case "placeGoal":
      return placeGoalIn(tree, mutation.id, mutation.afterId);
    case "placeKeyResult":
      return placeKeyResultIn(tree, mutation.id, mutation.afterId);
    case "deleteGoal":
    case "stopGoal":
      return withoutGoal(tree, mutation.id);
    case "reparent":
      return reparentIn(tree, mutation.id, mutation);
    case "setKind":
      return kindIn(tree, mutation.id, mutation.okrKind);
    case "restoreKeyResult":
    case "restoreGoal":
    case "publishDraft":
    case "approveDraft":
    case "reopenGoal":
    case "checkIn":
      // Nothing to guess: the row comes back with the server's answer, and a
      // check-in's health and next date are the server's to work out.
      return tree;
  }
}

export interface PendingConflict {
  readonly mutation: OkrMutation;
  readonly conflict: OkrConflict;
}

/**
 * A change the server refused, kept so the row can show what was typed with
 * the server's sentence and offer to send it again (design §4.5).
 */
export interface FailedChange {
  readonly mutation: OkrMutation;
  readonly error: string;
}

export function useOkrMutation(input: {
  readonly cycleId: string;
  readonly scope: OkrScope;
}) {
  const { t } = useTranslations();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = okrTreeKey(input.cycleId, input.scope);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [failed, setFailed] = useState<FailedChange | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const announce = useCallback(() => {
    if (typeof BroadcastChannel === "undefined") {
      return;
    }
    const channel = new BroadcastChannel(OKR_CHANNEL);
    channel.postMessage({ cycleId: input.cycleId });
    channel.close();
  }, [input.cycleId]);

  const mutation = useMutation<
    OkrOutcome,
    Error,
    OkrMutation,
    { readonly previous: OkrTree | undefined }
  >({
    mutationFn: (change) => runOkrMutation(change),
    onMutate: async (change) => {
      setProblem(null);
      setFailed(null);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<OkrTree>(key);
      if (previous) {
        queryClient.setQueryData(key, optimistic(previous, change));
      }
      return { previous };
    },
    onError: (_error, _change, saved) => {
      if (saved?.previous) {
        queryClient.setQueryData(key, saved.previous);
      }
      setProblem(t("okrTree.couldNotSave"));
    },
    onSuccess: (outcome, change, saved) => {
      if (!outcome.ok) {
        if (saved?.previous) {
          queryClient.setQueryData(key, saved.previous);
        }
        if (outcome.conflict) {
          setConflict({ mutation: change, conflict: outcome.conflict });
          return;
        }
        setFailed({ mutation: change, error: outcome.error });
        return;
      }
      if (outcome.goal) {
        const current = queryClient.getQueryData<OkrTree>(key);
        if (current) {
          queryClient.setQueryData(key, mergeGoal(current, outcome.goal));
        }
      } else {
        // A write that returns no node: the recomputed numbers are re-read.
        void queryClient.invalidateQueries({ queryKey: key });
      }
      // The drawer's history and alignment follow every write.
      void queryClient.invalidateQueries({ queryKey: OKR_DETAIL_ALL });
      announce();
      if (change.kind === "removeKeyResult") {
        toast.show({
          tone: "ok",
          message: t("okrTree.keyResultRemoved"),
          source: change.id,
          action: {
            label: t("okrTree.undo"),
            run: () =>
              mutation.mutate({ kind: "restoreKeyResult", id: change.id }),
          },
        });
      }
      if (change.kind === "reparent" && !change.undo) {
        toast.show({
          tone: "ok",
          message: t("okrTree.objectiveMoved"),
          source: change.id,
          action: {
            label: t("okrTree.undo"),
            run: () =>
              mutation.mutate({
                kind: "reparent",
                id: change.id,
                parentGoalId: change.from.parentGoalId,
                parentKeyResultId: change.from.parentKeyResultId,
                from: {
                  parentGoalId: change.parentGoalId,
                  parentKeyResultId: change.parentKeyResultId,
                },
                undo: true,
              }),
          },
        });
      }
      if (change.kind === "stopGoal") {
        toast.show({
          tone: "ok",
          message: t("okrTree.objectiveStopped"),
          source: change.id,
          action: {
            label: t("okrTree.undo"),
            run: () => mutation.mutate({ kind: "reopenGoal", id: change.id }),
          },
        });
      }
      if (change.kind === "deleteGoal") {
        toast.show({
          tone: "ok",
          message: t("okrTree.objectiveDeleted"),
          source: change.id,
          action: {
            label: t("okrTree.undo"),
            run: () => mutation.mutate({ kind: "restoreGoal", id: change.id }),
          },
        });
      }
    },
  });

  /** Keep mine: send it again, made from what is stored now. */
  const keepMine = useCallback(() => {
    if (!conflict) {
      return;
    }
    const { mutation: change, conflict: found } = conflict;
    setConflict(null);
    if (change.kind === "patchGoal" || change.kind === "patchKeyResult") {
      mutation.mutate({
        ...change,
        read: {
          ...change.read,
          ...(found.current as Record<string, string | number | null>),
        },
      });
    }
  }, [conflict, mutation]);

  /** Take theirs: drop mine and read what is stored. */
  const takeTheirs = useCallback(() => {
    setConflict(null);
    void queryClient.invalidateQueries({ queryKey: key });
  }, [key, queryClient]);

  /** Send a refused change again, as it was typed. */
  const retry = useCallback(() => {
    if (failed) {
      mutation.mutate(failed.mutation);
    }
  }, [failed, mutation]);

  const discard = useCallback(() => setFailed(null), []);

  return {
    mutate: mutation.mutate,
    pending: mutation.isPending,
    problem,
    failed,
    retry,
    discard,
    conflict,
    keepMine,
    takeTheirs,
  };
}

/** What every surface that edits the tree is handed: the list, the drawer. */
export type OkrHandle = ReturnType<typeof useOkrMutation>;

/**
 * The drawer's read of one objective (P9-T08a): check-ins, values, target
 * changes and alignment. Memory only, like the tree, and only while a tab
 * that shows it is open, so opening the details costs nothing extra.
 */
export function useOkrDetail(goal: OkrGoal, enabled: boolean) {
  const keyResultIds = goal.keyResults.map((keyResult) => keyResult.id);
  return useQuery<OkrDetail>({
    queryKey: okrDetailKey(goal.id, keyResultIds),
    queryFn: () => readOkrDetail({ goalId: goal.id, keyResultIds }),
    enabled,
    meta: { persist: false },
  });
}

export function useOkrLive(cycleId: string): void {
  const queryClient = useQueryClient();
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: okrCycleKey(cycleId) });
      void queryClient.invalidateQueries({ queryKey: OKR_DETAIL_ALL });
    };

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(OKR_CHANNEL);
      channel.onmessage = (event: MessageEvent<{ cycleId?: string }>) => {
        if (event.data?.cycleId === cycleId) {
          invalidate();
        }
      };
    }

    // The workspace stream carries nothing but "something moved", and a
    // member's own writes are not on it; one re-read per burst is enough.
    let source: EventSource | null = null;
    const onChanged = () => {
      if (waiting.current) {
        return;
      }
      waiting.current = setTimeout(() => {
        waiting.current = null;
        invalidate();
      }, LIVE_WINDOW_MS);
    };
    if (typeof EventSource !== "undefined") {
      source = new EventSource("/api/feed/live?scope=workspace");
      source.addEventListener("feed.changed", onChanged);
    }

    return () => {
      channel?.close();
      if (source) {
        source.removeEventListener("feed.changed", onChanged);
        source.close();
      }
      if (waiting.current) {
        clearTimeout(waiting.current);
        waiting.current = null;
      }
    };
  }, [cycleId, queryClient]);
}
