/**
 * What an agent may read: the items its own bindings name (completeness
 * review H-04).
 *
 * CLAUDE.md: "An agent gets bindings on named spaces, goals and KPI trees
 * only. Never a workspace-wide grant. There is no service account with
 * ambient authority." The Champion and the Coach were seeded that way, one
 * view binding per space, and then read every goal, KPI, blocker and session
 * in the workspace anyway, because nothing in their readers asked. The Coach
 * sent the titles it read to the model provider.
 *
 * Each fragment here is an `EXISTS` the reader adds to its own `WHERE`: the
 * agent's member group holds a live binding, at view or above, on the item's
 * own context or on its space's context. Written as SQL rather than as a list
 * of ids, because a workspace can hold a hundred thousand goals and a list
 * that size in an `IN` is the wrong shape for every one of them.
 *
 * **Coverage did not drop.** A goal or KPI that belongs to no space had no
 * binding an agent could hold, so the two built-in agents are now bound to each
 * one as it is created (`bindAgentsToContextInTx`), and data change 0009 binds
 * them to the ones that already exist. Akmal chose this on 28 September 2026
 * over exempting the built-in agents from the rule.
 *
 * Cycles are not scoped. They are the workspace's calendar, not its content,
 * and the cycle nudges they drive go to the people who run the calendar.
 */
import { blockers, checkIns, goals, kpis, okrSessions } from "@openokr/db";
import { type SQL, sql } from "drizzle-orm";
import { ACCESS_LEVELS } from "../access/levels.ts";

/** The agent a run reads as. */
export interface AgentScope {
  readonly memberId: string;
}

/** A context an item can be bound through: its type and the id it carries. */
type ContextRef = readonly [resourceType: string, resourceId: SQL];

/**
 * Whether the agent holds a view binding on any of the given contexts.
 *
 * Through the agent's own member group only. The two blanket groups never
 * reach an agent (`access/reads.ts`), and an agent is never in a space's
 * standard group, so a member group binding is the only way an agent sees
 * anything, which is the rule this enforces.
 */
function boundThroughAny(scope: AgentScope, refs: readonly ContextRef[]): SQL {
  const alternatives = refs.map(
    ([resourceType, resourceId]) =>
      sql`(c.resource_type = ${resourceType} and c.resource_id = ${resourceId})`,
  );
  return sql`exists (
    select 1
      from access_bindings b
      join access_groups g
        on g.id = b.group_id
       and g.deleted_at is null
      join access_contexts c
        on c.id = b.context_id
       and c.deleted_at is null
     where b.deleted_at is null
       and b.level >= ${ACCESS_LEVELS.view}
       and g.kind = 'member'
       and g.member_id = ${scope.memberId}
       and (${sql.join(alternatives, sql` or `)})
  )`;
}

/** The space a goal belongs to, as an expression over a goal id. */
const spaceOfGoal = (goalId: SQL): SQL =>
  sql`(select g2.space_id from goals g2 where g2.id = ${goalId})`;

/** The goal a key result belongs to, as an expression over its id. */
const goalOfKeyResult = (keyResultId: SQL): SQL =>
  sql`(select k2.goal_id from key_results k2 where k2.id = ${keyResultId})`;

/** A goal: bound on the goal itself, or on its space. */
export function agentSeesGoal(scope: AgentScope): SQL {
  return boundThroughAny(scope, [
    ["goal", sql`${goals.id}`],
    ["space", sql`${goals.spaceId}`],
  ]);
}

/** A goal named by id rather than by the `goals` row in the query. */
function agentSeesGoalId(scope: AgentScope, goalId: SQL): SQL {
  return boundThroughAny(scope, [
    ["goal", goalId],
    ["space", spaceOfGoal(goalId)],
  ]);
}

/** A check-in, through the goal it is about. */
export function agentSeesCheckIn(scope: AgentScope): SQL {
  return agentSeesGoalId(scope, sql`${checkIns.subjectId}`);
}

/**
 * A KPI: bound on the KPI itself, or on its space. A KPI that belongs to no
 * space owns a `kpi` context from its creation (`createKpiInTx`), which is
 * what an agent is bound to.
 */
export function agentSeesKpi(scope: AgentScope): SQL {
  return boundThroughAny(scope, [
    ["kpi", sql`${kpis.id}`],
    ["space", sql`${kpis.spaceId}`],
  ]);
}

/**
 * A blocker: through its goal (its own `goal_id`, or its key result's goal
 * when that was never recorded) or through the space of the session it was
 * raised in.
 */
export function agentSeesBlocker(scope: AgentScope): SQL {
  const goalId = sql`coalesce(${blockers.goalId}, ${goalOfKeyResult(sql`${blockers.keyResultId}`)})`;
  return boundThroughAny(scope, [
    ["goal", goalId],
    ["space", spaceOfGoal(goalId)],
    [
      "space",
      sql`(select s2.space_id from okr_sessions s2 where s2.id = ${blockers.sessionId})`,
    ],
  ]);
}

/** A session: through its space. */
export function agentSeesSession(scope: AgentScope): SQL {
  return boundThroughAny(scope, [["space", sql`${okrSessions.spaceId}`]]);
}
