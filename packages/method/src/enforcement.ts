/**
 * How hard each quality check is (METHOD.md §4, §12, P9-T03a).
 *
 * Checks keep reporting what they see: pass, warn, fail or todo. This one
 * step afterwards decides what that means for this workspace, so a level is a
 * setting rather than a second implementation of the check:
 *
 * | Level | Fail | Warn |
 * |---|---|---|
 * | block | fail | fail |
 * | structural | fail | warn |
 * | warn | warn | warn |
 * | info | info | info |
 * | off | dropped | dropped |
 *
 * A check's default level is §4's own table, which for some checks is more
 * than one level: KR-1 blocks at none and warns at one or above five, which is
 * `structural`, the check's own fail rows blocking and its warn rows warning.
 * The cycle checks are information unless the phases are binding, when they
 * decide phase completion and block.
 *
 * **Strict mode raises every check to block**, except one a workspace turned
 * off on purpose: off means not evaluated, and strict mode is about how hard
 * an evaluated check is.
 *
 * Pure. The coach in the browser, the server before a write and the publish
 * gates all call it, so a level cannot mean one thing in one and another in
 * another.
 */
import type {
  CheckEnforcement,
  PracticeCheckId,
  ResolvedPractice,
} from "./practice.ts";
import { PRACTICE_CHECK_IDS } from "./practice.ts";
import type { QualityVerdict } from "./quality.ts";

/** A level after `asMethod` has been read from §4. */
export type EnforcementLevel = "block" | "structural" | "warn" | "info" | "off";

/** §4's default level for each check, which `asMethod` means. */
export const CHECK_DEFAULT_LEVELS: Readonly<
  Record<PracticeCheckId, EnforcementLevel | "phaseBound">
> = {
  "OBJ-1": "warn",
  "OBJ-2": "warn",
  "OBJ-3": "block",
  "OBJ-4": "block",
  "OBJ-5": "warn",
  "KR-1": "structural",
  "KR-2": "warn",
  "KR-3": "structural",
  "KR-4": "info",
  "KR-5": "warn",
  "KR-6": "info",
  "KR-7": "structural",
  "AL-1": "warn",
  "AL-2": "block",
  "AL-3": "off",
  "AL-4": "warn",
  "AL-5": "warn",
  "AL-6": "off",
  "CY-1": "phaseBound",
  "CY-2": "phaseBound",
  "CY-3": "phaseBound",
  "CY-4": "phaseBound",
  "CY-5": "phaseBound",
  "CY-6": "phaseBound",
  "CY-7": "phaseBound",
  "CY-8": "phaseBound",
};

const isCheckId = (id: string): id is PracticeCheckId =>
  (PRACTICE_CHECK_IDS as readonly string[]).includes(id);

/**
 * The level one check runs at under this practice.
 *
 * `strict` also carries the §11 "Coach strictness" threshold at `strict`,
 * workspace-wide or for one space, which meant the same thing before strict
 * mode was a practice setting and still does.
 */
export function enforcementLevel(
  id: string,
  practice: ResolvedPractice,
  options: { readonly strict?: boolean } = {},
): EnforcementLevel {
  if (!isCheckId(id)) {
    // A verdict from a check this table does not know is shown as it came.
    return "structural";
  }
  const chosen: CheckEnforcement = practice[`checks.${id}`];
  if (chosen === "off") {
    return "off";
  }
  if (practice.strictMode === "on" || options.strict) {
    return "block";
  }
  if (chosen !== "asMethod") {
    return chosen;
  }
  const level = CHECK_DEFAULT_LEVELS[id];
  if (level === "phaseBound") {
    return practice["phases.enforcement"] === "binding" ? "block" : "info";
  }
  return level;
}

/** Applies each check's level to its verdict, and drops the checks that are off. */
export function applyEnforcement<T extends QualityVerdict>(
  verdicts: readonly T[],
  practice: ResolvedPractice,
  options: { readonly strict?: boolean } = {},
): readonly T[] {
  const enforced: T[] = [];
  for (const verdict of verdicts) {
    const level = enforcementLevel(verdict.id, practice, options);
    if (level === "off") {
      continue;
    }
    if (verdict.status !== "fail" && verdict.status !== "warn") {
      enforced.push(verdict);
      continue;
    }
    const status =
      level === "block"
        ? "fail"
        : level === "warn"
          ? "warn"
          : level === "info"
            ? "info"
            : verdict.status;
    enforced.push(status === verdict.status ? verdict : { ...verdict, status });
  }
  return enforced;
}
