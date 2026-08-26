/**
 * The feature key for every assist, in one module that imports nothing.
 *
 * **Here rather than beside each assist, and the reason is an import cycle.**
 * They started life exported from `actions/goal-assists.ts` and
 * `actions/rhythm-assists.ts`. `index.ts` re-exported them, which made
 * `index.ts` load those action modules, which load `actions/goals.ts` and
 * `actions/kpis.ts`, which meant `registry.ts` could be evaluated while a module
 * it depends on was still initialising. `ACTION_MAP` then held `undefined` for
 * whichever action had not finished, and nineteen tests failed with "Cannot read
 * properties of undefined (reading 'handler')" on `goals.create`, an action that
 * has nothing to do with assists.
 *
 * A module with no imports cannot be part of a cycle. That is the whole design.
 *
 * P2-T15's registry has no fixed list of keys, so these are the strings, in one
 * place, rather than typed at each call site. `resolveFeatureTier` treats a
 * missing row as enabled, which is AI-NATIVE-PLAN §4's "on by default where a
 * provider is configured": an administrator turns one off, and nobody has to turn
 * anything on.
 */

/** AI-NATIVE-PLAN §2.1's planning and drafting assists (P4-T15a). */
export const ASSIST_FEATURE_KEYS = {
  draftObjective: "assists.draftObjective",
  suggestMeasure: "assists.suggestMeasure",
  suggestParent: "assists.suggestParent",
  /** §2.4's list filter (P4-T15d). */
  parseFilter: "assists.parseFilter",
} as const;

/** §2.2's rhythm narrations (P4-T15b-a). */
export const RHYTHM_ASSIST_KEYS = {
  narrateDigest: "assists.narrateDigest",
  narrateTrend: "assists.narrateTrend",
} as const;
