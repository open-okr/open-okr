/**
 * What the coach watches for, and what it says (METHOD.md §10, P9-T21).
 *
 * §10's twenty situations, each with the line a real OKR coach would say and
 * the rule it cites. The words are the document's, compared in both
 * directions by the conformance suite, so the coach cannot say something the
 * method does not and the method cannot add a line the coach never says.
 *
 * A line is said beside the rule's own message, never instead of it: the
 * check or the trigger decides, and this is only how it sounds. A situation
 * whose rule a workspace has turned off is not raised, which is the rule's
 * business rather than this list's.
 */

export interface CoachLine {
  /** §10's "Situation". */
  readonly situation: string;
  /** §10's "What the coach says", without its closing punctuation. */
  readonly says: string;
  /** The §4 or §5 check, or the AI-NATIVE-PLAN §6.4 trigger, it cites. */
  readonly ruleKey: string;
}

export const COACH_LINES: readonly CoachLine[] = [
  {
    situation: "Objective starts with an output verb",
    says: "If we do it and nothing changes, did we succeed?",
    ruleKey: "OBJ-1",
  },
  {
    situation: "Objective contains numbers",
    says: "Metrics usually belong in the key results",
    ruleKey: "OBJ-2",
  },
  {
    situation: "Metric key result has no baseline",
    says: "Where are you today? If you do not know, establishing it can be its own key result",
    ruleKey: "KR-2",
  },
  {
    situation: "Key result measures activity volume",
    says: "More calls, to what end? If you can measure that impact, make it the key result",
    ruleKey: "KR-5",
  },
  {
    situation: "Tagged key results are all lagging",
    says: "You will only find out at the end. Add a leading indicator you can act on weekly",
    ruleKey: "KR-4",
  },
  {
    situation: "Aspirational set near certain at draft",
    says: "If this must be delivered, mark it committed. If it is a stretch, raise the targets",
    ruleKey: "KR-6",
  },
  {
    situation:
      "Committed key result below 0.7 confidence, at drafting or at a check-in",
    says: "A commitment nobody believes in is a risk. Escalate now, or make it aspirational",
    ruleKey: "quality.committed_floor",
  },
  {
    situation: "More than five company objectives",
    says: "If everything is a priority, nothing can be chosen. Which two would you drop?",
    ruleKey: "OBJ-5",
  },
  {
    situation: "Not-doing list empty at the end of an annual Phase 3",
    says: "A list that accommodates everything is a to-do list, not a strategy",
    ruleKey: "CY-5",
  },
  {
    situation: "Goal with no parent and no stated reason",
    says: "Which priority does this move forward? If it stands alone, say why",
    ruleKey: "AL-1",
  },
  {
    situation: "Two goals may double-count a metric",
    says: "These two claim the same movement. Check which one owns it",
    ruleKey: "quality.conflict",
  },
  {
    situation: "Dependency unconfirmed",
    says: "Unconfirmed is a risk. Get the confirmation, escalate, or name a risk owner",
    ruleKey: "AL-5",
  },
  {
    situation: "Capacity check with nothing cut",
    says: "What did you stop doing to make room?",
    ruleKey: "CY-6",
  },
  {
    situation: "Check-in overdue past grace",
    says: "This goal is stale. It cannot quietly stay green",
    ruleKey: "checkin.stale",
  },
  {
    situation: "Blocker action past the next check-in",
    says: "This blocker has not moved. Raising it with the coordinator",
    ruleKey: "blocker.overdue",
  },
  {
    situation: "Confidence fell into the low band",
    says: "What changed? Name the next action",
    ruleKey: "confidence.critical",
  },
  {
    situation: "Reported health disagrees with the data",
    says: "Reported on track, but this key result has not moved within the divergence window",
    ruleKey: "quality.divergence",
  },
  {
    situation: "Trend forecast misses the target",
    says: "On current trajectory this misses. Better to say it now than at the close",
    ruleKey: "quality.trending_off",
  },
  {
    situation: "KPI turns unhealthy",
    says: "This KPI is unhealthy. Fix it now, add a key result, or launch the drafted recovery OKR",
    ruleKey: "kpi.unhealthy",
  },
  {
    situation: "Pattern of 1.0s on aspirational key results at the close",
    says: "Targets were too safe. Address stretch explicitly when drafting the next cycle",
    ruleKey: "quality.sandbagging_close",
  },
];

/** The line the coach says for a rule, or undefined where §10 has none. */
export function coachLineFor(ruleKey: string): CoachLine | undefined {
  return COACH_LINES.find((line) => line.ruleKey === ruleKey);
}

/** A line as a sentence: its own question mark, or a full stop. */
export function coachSentence(line: CoachLine): string {
  return /[.?!]$/.test(line.says) ? line.says : `${line.says}.`;
}
