import type { ErasureExport } from "@openokr/core";

/**
 * What a lifecycle control hands back (P6-G10).
 *
 * Separate from `lifecycle-actions.ts` because a `"use server"` module may
 * export only async functions, and both the client component and the actions
 * need this shape.
 *
 * **The erasure export travels in the result and nowhere else.** Erasing a
 * member overwrites the row it came from, so there is no second call that
 * could fetch it afterwards. Losing this object loses the only copy, which is
 * why the panel renders the download before it says anything else.
 */
export type LifecycleState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "done";
      readonly message: string;
      readonly export: ErasureExport | null;
    }
  | { readonly kind: "refused"; readonly message: string };

export const IDLE: LifecycleState = { kind: "idle" };
