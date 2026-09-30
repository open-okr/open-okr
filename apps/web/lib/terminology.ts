import type { ResolvedTerminology } from "@openokr/method";
import { cache } from "react";
import { readRhythmForRequest } from "./rhythm";

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
 * **Resolved once per request, from the one `rhythm.read` every screen
 * shares** (`rhythm.ts`), so the progress ceiling, the catalogue's term holes
 * and this cost one call between them.
 *
 * **Most screens do not need this.** A catalogue string that names a term
 * holds a term hole that `t()` fills from `workspaceTerms()` (completeness
 * review M-14). This is for the one place a term has to be taken apart
 * rather than printed: the Work Map's row-kind chip, which abbreviates a
 * renamed word (`rowKindAbbreviation` in `work-map.tsx`).
 */
export const workspaceTerminology = cache(
  async (): Promise<ResolvedTerminology> => {
    const read = await readRhythmForRequest();
    // Same open-record cast `progressCeiling` makes for `thresholds`, and for
    // the same reason: the contract boundary types this as a plain record.
    return read.terminology as unknown as ResolvedTerminology;
  },
);
