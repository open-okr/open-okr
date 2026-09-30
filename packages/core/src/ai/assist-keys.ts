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
  /** §7.1 step 2's column mapping for a spreadsheet import (P6-T01b-a). */
  proposeImportMapping: "assists.proposeImportMapping",
  /** §2.4's thread summary (completeness review M-09). */
  summariseThread: "assists.summariseThread",
  /** §2.4's key result decomposition into initiatives and tasks (M-09). */
  decomposeKeyResult: "assists.decomposeKeyResult",
} as const;

/**
 * Fewer comments than this is a thread a reader takes in at a glance, so the
 * thread summary is neither offered nor run (M-09).
 *
 * A product constant rather than a practice threshold: METHOD.md says nothing
 * about how long a discussion has to be before it is worth summarising, and
 * the same judgement is made for retro themes, which need three notes. Here
 * rather than beside the action for the reason this module exists: a screen
 * offers the assist on the same terms the action runs it, and importing the
 * action module to learn one number would bring the cycle back.
 */
export const THREAD_SUMMARY_MINIMUM = 3;

/** §2.3's review assists (P4-T15c). */
export const REVIEW_ASSIST_KEYS = {
  clusterRetro: "assists.clusterRetro",
  narrateDiagnostic: "assists.narrateDiagnostic",
  draftMinutes: "assists.draftMinutes",
  draftRetrospective: "assists.draftRetrospective",
  proposeObjectives: "assists.proposeObjectives",
} as const;

/** §2.2's rhythm narrations (P4-T15b-a). */
export const RHYTHM_ASSIST_KEYS = {
  narrateDigest: "assists.narrateDigest",
  narrateTrend: "assists.narrateTrend",
  /** §2.2's blocker summary (P4-T15b-b). */
  summariseBlockers: "assists.summariseBlockers",
  /** §2.2's KPI suggestion (P4-T15b-b). */
  suggestKpi: "assists.suggestKpi",
} as const;
