import { callAction } from "@openokr/core";
import type { ResolvedTerminology } from "@openokr/method";
import { cache } from "react";
import { getPool } from "./auth";
import { requireWorkspace } from "./workspace";

/**
 * This workspace's renamed concepts, resolved against the METHOD.md canon
 * (TECHNICAL-PLAN §4.14).
 *
 * **The write path shipped at P3-T02 and nothing ever read it back.** A
 * workspace could rename Objective to Goal on Admin, Rhythm and Thresholds,
 * Terminology, the value persisted and survived a reload, and every screen
 * kept saying Objective regardless. Found by a manual UAT pass, 29 September
 * 2026 (M06-03/M06-06's precondition, M03-06's own case): `rhythm.read`
 * already resolves `terminology` from the workspace's labels, the same way
 * `progressCeiling` (`ceilings.ts`) reads `thresholds` from the same call.
 * Nothing before this called it for that field.
 *
 * **Resolved once per request**, the same reasoning as `progressCeiling`: a
 * screen naming several of the fourteen renameable terms should not cost one
 * `rhythm.read` per mention.
 *
 * **This wires the Work Map and the goals explorer, which share `WorkMap`
 * and `GoalTable` in `work-map.tsx`.** Every other screen that names
 * "objective", "key result" or one of the other twelve terms still reads the
 * canon word regardless of what a workspace renamed it to; that is a larger,
 * separate piece of work across many screens, not something this fix
 * attempts.
 */
export const workspaceTerminology = cache(
  async (): Promise<ResolvedTerminology> => {
    const { session, workspace } = await requireWorkspace();
    const read = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human" as const, userId: session.user.id },
      },
      "rhythm.read",
      {},
    );
    // Same open-record cast `progressCeiling` makes for `thresholds`, and for
    // the same reason: the contract boundary types this as a plain record.
    return read.terminology as unknown as ResolvedTerminology;
  },
);
