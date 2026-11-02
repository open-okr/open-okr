/**
 * A rule described for a preview, from the catalogues alone.
 *
 * Every verdict and every nudge names its rule by key, "KR-3" or
 * "checkin.overdue", and a reader cannot know what either means without
 * opening the rule. A preview says it where the key is shown, in the words
 * the catalogues already hold: a check by its title and the cases it looks
 * for, a trigger by its title, when it fires and who hears it. No screen
 * writes its own account of a rule, so none can disagree with what fired.
 *
 * Pure. No database, no clock, no network, no framework.
 */
import {
  ALIGNMENT_CHECKS,
  CYCLE_CHECKS,
  KEY_RESULT_CHECKS,
  OBJECTIVE_CHECKS,
  type QualityCheck,
} from "./quality.ts";
import { checkSection } from "./sections.ts";
import { TRIGGER_CATALOGUE } from "./triggers.ts";

export interface RuleDescription {
  readonly key: string;
  readonly kind: QualityCheck["group"] | "trigger";
  /** "KR-3 Complete", or a trigger's title. */
  readonly name: string;
  /** A check's cases other than its pass, in the catalogue's words. */
  readonly looksFor: readonly string[];
  /** A trigger's condition, in the catalogue's words. */
  readonly fires: string | null;
  readonly recipient: string | null;
  /**
   * The METHOD.md section that sets the rule out. Null for a trigger, whose
   * catalogue is AI-NATIVE-PLAN's rather than METHOD.md's.
   */
  readonly section: string | null;
}

const CHECKS: readonly QualityCheck[] = [
  ...OBJECTIVE_CHECKS,
  ...KEY_RESULT_CHECKS,
  ...ALIGNMENT_CHECKS,
  ...CYCLE_CHECKS,
];

/**
 * The rule a key names, or null. Case-insensitive, as the rule page reads its
 * address, so a link that works also previews.
 */
export function describeRule(key: string): RuleDescription | null {
  const wanted = key.toLowerCase();
  const check = CHECKS.find((entry) => entry.id.toLowerCase() === wanted);
  if (check) {
    return {
      key: check.id,
      kind: check.group,
      name: `${check.id} ${check.title}`,
      looksFor: check.conditions
        .filter((row) => row.status !== "pass")
        .map((row) => row.condition),
      fires: null,
      recipient: null,
      section: checkSection(check.id),
    };
  }
  const trigger = TRIGGER_CATALOGUE.find(
    (entry) => entry.key.toLowerCase() === wanted,
  );
  if (trigger) {
    return {
      key: trigger.key,
      kind: "trigger",
      name: trigger.title,
      looksFor: [],
      fires: trigger.fires,
      recipient: trigger.recipient,
      section: null,
    };
  }
  return null;
}
