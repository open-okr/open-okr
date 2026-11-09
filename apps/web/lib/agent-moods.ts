import { type TriggerKey, trigger } from "@openokr/method";
import type { AgentFaceKind, AgentMood } from "@openokr/ui";

/**
 * The face each proactive message wears (docs/design/agent-faces.md §3).
 *
 * **Presentation, not practice.** Which trigger fires, when, and for whom is
 * METHOD.md's and lives in `packages/method`. How the agent looks while it
 * says so is this file's, and it decides nothing: a nudge reads the same with
 * every face drawn still.
 *
 * `satisfies` over the whole catalogue, so a trigger added to the method
 * package without a mood here fails the typecheck rather than drawing a
 * default nobody chose.
 *
 * | Mood      | When                                                   |
 * |-----------|--------------------------------------------------------|
 * | idle      | A routine reminder: something is due, nothing is wrong |
 * | thinking  | A question to consider, or a proposal to weigh         |
 * | happy     | Good news: a cycle or session starting, a KPI back     |
 * | sad       | Something was missed or is now late                    |
 * | surprised | Something just changed and wants attention now         |
 */
const TRIGGER_MOODS = {
  // The Champion: the rhythm.
  "checkin.due_soon": "idle",
  "checkin.due": "idle",
  "checkin.overdue": "sad",
  "checkin.stale": "sad",
  "checkin.week": "idle",
  "checkin.peer": "sad",
  "ack.owed": "idle",
  "ack.overdue": "sad",
  "blocker.warning": "surprised",
  "blocker.overdue": "sad",
  "blocker.escalated": "surprised",
  "confidence.critical": "surprised",
  "commitment.due": "idle",
  "session.due_soon": "idle",
  "session.open": "happy",
  "session.missed": "sad",
  "streak.at_risk": "surprised",
  "digest.weekly": "happy",
  "digest.daily": "idle",
  // The eyes glancing side to side are what watching looks like.
  "kpi.watch": "idle",
  "kpi.unhealthy": "surprised",
  "kpi.recovery_proposed": "thinking",
  "kpi.recovered": "happy",
  "cycle.planning_opens": "idle",
  "cycle.phase_blocked": "sad",
  "cycle.deadline": "surprised",
  "cycle.starts": "happy",
  "cycle.review_due": "idle",
  "cycle.closing": "sad",
  "channel.reconnect_needed": "sad",

  // The Coach: quality. Mostly a question, because asking the question that
  // exposes the gap is what the Coach does (METHOD.md §4).
  "quality.draft_failing": "thinking",
  "quality.gate_blocked": "sad",
  "quality.no_not_doing": "thinking",
  "quality.too_many_objectives": "surprised",
  "quality.all_lagging": "thinking",
  "quality.no_baseline": "thinking",
  "quality.committed_floor": "sad",
  "quality.sandbagging_draft": "thinking",
  "quality.sandbagging_close": "thinking",
  "quality.orphan_goal": "thinking",
  "quality.level_skip": "thinking",
  "quality.silo": "thinking",
  "quality.conflict": "surprised",
  "quality.dependency_unowned": "thinking",
  "quality.no_cuts": "thinking",
  "quality.divergence": "surprised",
  "quality.trending_off": "sad",
  "quality.process_health_low": "sad",
  // Somebody asked, and it answered (plan 0.7.0 A8).
  "quality.review_requested": "happy",
} as const satisfies Record<TriggerKey, AgentMood>;

/** The trigger keys that have a mood. Exported for the test, not for rendering. */
export const MOODED_TRIGGERS: readonly string[] = Object.keys(TRIGGER_MOODS);

/**
 * Who sent a proactive message and how they look saying it, or null for a key
 * the catalogue does not define. A stored row's key is only a string until it
 * is checked, so an unknown one draws no face rather than a guessed one.
 */
export function faceForTrigger(
  key: string,
): { readonly agent: AgentFaceKind; readonly mood: AgentMood } | null {
  const found = trigger(key);
  if (found === undefined) {
    return null;
  }
  return {
    agent: found.owner,
    mood: TRIGGER_MOODS[found.key as TriggerKey],
  };
}

/**
 * How an agent looks for the state of one of its runs.
 *
 * A halt is shown asleep, not sad: the Champion's cost cap stops a run without
 * failing it (admin/agents/page.tsx), and a face that grieved over a limit the
 * workspace chose would teach people to ignore the one for a real failure. A
 * run that completed with nothing to do is idle rather than pleased.
 */
export function moodForRun(
  status: string,
  logged: number,
): { readonly mood: AgentMood; readonly live: boolean } {
  switch (status) {
    case "planning":
    case "running":
      return { mood: "thinking", live: true };
    case "completed":
      return { mood: logged > 0 ? "happy" : "idle", live: false };
    case "cancelled":
      return { mood: "sleeping", live: false };
    case "failed":
      return { mood: "sad", live: false };
    default:
      return { mood: "idle", live: false };
  }
}
