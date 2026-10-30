/**
 * What an agent is told about an input field the action's schema leaves
 * undescribed (mcp-audit-2026-10-29, finding 6).
 *
 * Keyed by field name, because the registry names a field the same way
 * wherever it appears: a `goalId` is a goal's id in every action that takes
 * one. `id` is the exception, and is described by the tool's family. A field
 * whose schema already carries a description keeps its own.
 *
 * Every field of every `core` tool has an entry, which a test holds. Each
 * sentence says what the value is and where an agent gets it; none restates a
 * rule, threshold or word list, which belong to `packages/method`.
 */

const ID_BY_FAMILY: Readonly<Record<string, string>> = {
  goals: "The goal's id, from goals.list, goals.due or goals.tree.",
  spaces: "The space's id, from spaces.list.",
  documents: "The document's id, from documents.list.",
  tasks: "The task's id, from tasks.list or tasks.board.",
  initiatives: "The initiative's id, from initiatives.list.",
  sessions: "The session's id, from sessions.mine.",
  people: "The member's id, from people.directory.",
  kpis: "The KPI's id, from kpis.list.",
  cycles: "The cycle's id, from cycles.list or cycles.current.",
};

const FIELDS: Readonly<Record<string, string>> = {
  goalId: "The goal's id, from goals.list, goals.due or goals.tree.",
  keyResultId:
    "The key result's id, from the keyResults of goals.read or goals.list.",
  keyResultIds:
    "Key result ids, from the keyResults of goals.read or goals.list.",
  spaceId: "The space's id, from spaces.list.",
  cycleId: "The cycle's id, from cycles.current or cycles.list.",
  initiativeId: "The initiative's id, from initiatives.list.",
  kpiId: "The KPI's id, from kpis.list.",
  memberId: "A member's id, from people.directory.",
  ownerId: "The member who owns it, by id from people.directory.",
  championId:
    "The member accountable for the goal, by id from people.directory. Defaults to the caller.",
  reviewerId:
    "The member who reviews the goal's check-ins, by id from people.directory.",
  assigneeIds: "Members to assign, by id from people.directory.",
  commentId: "The comment's id, from comments.list.",
  notificationId: "The notification's id, from notifications.list.",
  parentGoalId: "The goal this one aligns up to, by id.",
  parentKeyResultId: "The key result this goal contributes to, by id.",
  strategyId: "The strategic thrust this goal serves, by id from frame.read.",
  afterTaskId:
    "The card it lands after in the column. Leave out for the top of the column.",
  subjectType: "What the item is attached to.",
  subjectId: "The id of the item it is attached to, matching subjectType.",
  title: "A short title, as a person would read it in a list.",
  description: "A longer explanation, in plain words.",
  status: "The state to set or to filter by.",
  level: "The level of the goal: company, department, team or individual.",
  kind: "The kind, from the listed values.",
  ownerKind:
    "Who owns the goal: the workspace, a space (needs spaceId) or a member (needs memberId).",
  timeframe:
    "Start and end dates (YYYY-MM-DD) when the goal does not follow its cycle.",
  weight: "Relative weight in its parent's progress. 1 is a normal weight.",
  capacity:
    "Whether the work fits the team's capacity: fits, tight or exceeds.",
  confidence: "Confidence that it will land, from 0 to 1. 7 in 10 is 0.7.",
  contributionStatement:
    "One sentence on how this goal contributes to the one it aligns to.",
  standaloneReason:
    "Why the goal stands alone instead of aligning to another, when it does.",
  reason: "One line on why, where the workspace asks for one.",
  targetReason: "Why the target moved, kept with the change.",
  carryForward: "True to carry the key result into the next cycle.",
  checkInFrequency: "How often the goal is checked in.",
  guided: "Accepted and ignored. Leave it out.",
  unit: "The unit the value is measured in, such as %, customers or days.",
  direction:
    "Which way success moves: increase, reduce, maintain or move to a value.",
  indicatorType:
    "Leading (moves early and predicts) or lagging (confirms the result).",
  baselineValue: "Where the measure starts.",
  targetValue: "Where the measure should be at the end.",
  currentValue:
    "Where the measure is today, when it differs from the baseline.",
  value: "The new value, in the key result's unit.",
  values:
    "One entry per key result being updated: keyResultId and the new value, optionally a confidence or done.",
  done: "True when a milestone is done or a baseline is recorded.",
  note: "A short note kept with the change.",
  dueOn: "The due date, as YYYY-MM-DD.",
  dueBy: "Only items due on or before this date, as YYYY-MM-DD.",
  startsOn: "The start date, as YYYY-MM-DD.",
  endsOn: "The end date, as YYYY-MM-DD.",
  on: "Any date inside the period being recorded, as YYYY-MM-DD.",
  actualValue: "The value measured for the period.",
  remark: "A short remark kept with the record.",
  periods: "How many periods to return, newest first.",
  health: "Only goals with this health.",
  mine: "True for only the caller's own.",
  includeClosed: "True to include closed goals.",
  includeDrafts: "True to include unpublished draft check-ins.",
  includeFinished: "True to include sessions that have finished.",
  includeSuspended: "True to include suspended members.",
  unreadOnly: "True for unread notifications only.",
  scope:
    "all for everything visible, mine for what the caller owns or reviews.",
  mode: "annual or quarterly cycles.",
  withinDays: "Days ahead to count as due. 0 is due today or overdue only.",
  limit: "The most rows to return.",
  cursor: "The cursor from the previous page's answer, for the next page.",
  search: "Words to match against names.",
  kinds: "Only these kinds. Every kind when left out.",
  query: "Words to search for.",
  entityTypes: "Only these kinds of results. Every kind when left out.",
  url: "An OpenOKR address: a browser path or a URL on this instance.",
  type: "The type, from the listed values.",
  nextAction:
    "The next concrete step that would unblock it, due by the goal's next check-in.",
  keyResults: "The key results, in order. Verdicts refer to them by index.",
};

/** The description for one field of one tool, or null when there is none. */
export function fieldDescription(tool: string, field: string): string | null {
  if (field === "id") {
    return ID_BY_FAMILY[tool.split(".")[0] ?? ""] ?? null;
  }
  return FIELDS[field] ?? null;
}
