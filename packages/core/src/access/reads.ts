/**
 * `can()` and the access-aware getter (TECHNICAL-PLAN §4.1, §8.1 layer 2,
 * P2-T02).
 *
 * One enforcement point for every surface. A member's effective level on a
 * context is the maximum over three reachable tiers: their own `member`
 * group, the workspace's `workspace_standard` group (every active member
 * belongs to it by definition), and any `space_standard` group they hold a
 * live `access_group_memberships` row in. A suspended or missing member
 * resolves to zero on every context, which is what makes not-found the
 * answer for them without a separate check at every call site.
 *
 * The three functions below share that one computation rather than each
 * re-deriving it: `resolveMemberAccessLevel` for a single context,
 * `accessScopeFilter` for a list of rows carrying a `context_id` column, and
 * `getAccessScoped` for the single-resource read that resolves a subject to
 * its context first. `can()` is a one-line predicate over the first.
 */
import {
  accessContexts,
  activeOnly,
  comments,
  documents,
  reactions,
  type WorkspaceTx,
  withWorkspace,
} from "@openokr/db";
import { eq, type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { OperationError } from "../operations/operation.ts";
import { ACCESS_LEVELS, type AccessLevel } from "./levels.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export interface MemberContextInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly contextId: string;
}

/**
 * The member's effective level on one context, or `0` if none of the three
 * tiers reaches them, they hold no live binding, or the member is missing,
 * soft-deleted or not `active`. Never throws: a level of `0` is always a
 * valid answer, and it is what a caller compares against a required level.
 */
export async function resolveMemberAccessLevel<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: MemberContextInput): Promise<number> {
  const result = await tx.execute<{ level: number }>(sql`
    with actor as (
      select kind from workspace_members
       where id = ${input.memberId}
         and workspace_id = ${input.workspaceId}
         and status = 'active'
         and deleted_at is null
    )
    select coalesce(max(b.level), 0)::int as level
      from access_bindings b
      join access_groups g
        on g.id = b.group_id
       and g.deleted_at is null
       and g.workspace_id = ${input.workspaceId}
     where b.context_id = ${input.contextId}
       and b.workspace_id = ${input.workspaceId}
       and b.deleted_at is null
       and exists (select 1 from actor)
       and (
         (g.kind = 'member' and g.member_id = ${input.memberId})
         -- The two blanket tiers reach only a human member. A guest, an
         -- agent or a placeholder never inherits general workspace-wide
         -- access this way — an agent in particular must hold nothing but
         -- its own named bindings (AI-NATIVE-PLAN §1.3: "no service account
         -- with ambient authority"), and a guest converted from a fuller
         -- kind must actually lose what workspace_standard would otherwise
         -- hand straight back.
         or (
           g.kind = 'workspace_standard'
           and exists (select 1 from actor where kind = 'human')
         )
         or (
           g.kind = 'space_standard'
           and exists (select 1 from actor where kind = 'human')
           and exists (
             select 1 from access_group_memberships gm
              where gm.group_id = g.id
                and gm.member_id = ${input.memberId}
                and gm.deleted_at is null
           )
         )
       )
  `);
  return Number(result.rows[0]?.level ?? 0);
}

/** Whether a member's effective level on a context meets `level`. */
export async function can<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: MemberContextInput,
  level: AccessLevel,
): Promise<boolean> {
  return (await resolveMemberAccessLevel(tx, input)) >= level;
}

/**
 * The level a member holds on their own workspace's context, from a plain
 * `Pool` rather than a transaction already open on one (TECHNICAL-PLAN
 * §4.1, P2-T08). For a caller outside the Operation pipeline — the module
 * registry's own consumer, filtering a navigation menu or denying a route —
 * that has a workspace and a member id already and nothing else: the same
 * shape `listMembershipsForUser` already gives read-only callers in
 * `workspaces/memberships.ts`, so `apps/web` never has to open its own
 * transaction to ask this.
 */
export async function resolveOwnWorkspaceAccessLevel(
  pool: Pool,
  workspaceId: string,
  memberId: string,
): Promise<number> {
  const db = drizzle(pool);
  return withWorkspace(db, workspaceId, async (tx) => {
    const context = await resolveSubjectContext(
      tx,
      "workspace",
      workspaceId,
      workspaceId,
    );
    if (!context) {
      return 0;
    }
    return resolveMemberAccessLevel(tx, {
      workspaceId,
      memberId,
      contextId: context.contextId,
    });
  });
}

export interface AnonymousContextInput {
  readonly workspaceId: string;
  readonly contextId: string;
}

/**
 * The unauthenticated principal's level on a context: the `anonymous`
 * group's own live bindings, and nothing else. There is no member row behind
 * this request, so none of the three member-reachable tiers apply; a
 * resource is only visible to an anonymous caller when its derived privacy is
 * `public` (TECHNICAL-PLAN §4.1), which is exactly what an anonymous binding
 * records. Kept separate from `resolveMemberAccessLevel` rather than making
 * `memberId` optional there: an anonymous request has no member to load or
 * exclude for suspension, so folding it in would make every member query
 * carry a branch for a case that can never apply to it.
 */
export async function resolveAnonymousAccessLevel<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: AnonymousContextInput): Promise<number> {
  const result = await tx.execute<{ level: number }>(sql`
    select coalesce(max(b.level), 0)::int as level
      from access_bindings b
      join access_groups g
        on g.id = b.group_id
       and g.deleted_at is null
       and g.workspace_id = ${input.workspaceId}
       and g.kind = 'anonymous'
     where b.context_id = ${input.contextId}
       and b.workspace_id = ${input.workspaceId}
       and b.deleted_at is null
  `);
  return Number(result.rows[0]?.level ?? 0);
}

export interface AccessScopeFilterInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly minLevel: AccessLevel;
}

/**
 * A composable filter for listing rows the member can see: an `EXISTS`
 * clause over the same three tiers `resolveMemberAccessLevel` walks,
 * parameterised on whichever column holds the row's `context_id`. Drop it
 * into any `.where()` alongside the query's other conditions; nothing here
 * fetches or aggregates on its own.
 */
export function accessScopeFilter(
  contextIdColumn: AnyPgColumn,
  input: AccessScopeFilterInput,
): SQL {
  return sql`exists (
    select 1
      from access_bindings b
      join access_groups g
        on g.id = b.group_id
       and g.deleted_at is null
       and g.workspace_id = ${input.workspaceId}
     where b.context_id = ${contextIdColumn}
       and b.workspace_id = ${input.workspaceId}
       and b.deleted_at is null
       and b.level >= ${input.minLevel}
       and exists (
         select 1 from workspace_members m
          where m.id = ${input.memberId}
            and m.workspace_id = ${input.workspaceId}
            and m.status = 'active'
            and m.deleted_at is null
       )
       and (
         (g.kind = 'member' and g.member_id = ${input.memberId})
         -- The two blanket tiers reach only a human member, same restriction
         -- and same reason as resolveMemberAccessLevel above: an agent must
         -- never inherit ambient access, and a guest must actually lose it.
         or (
           g.kind = 'workspace_standard'
           and exists (
             select 1 from workspace_members m
              where m.id = ${input.memberId} and m.kind = 'human'
           )
         )
         or (
           g.kind = 'space_standard'
           and exists (
             select 1 from workspace_members m
              where m.id = ${input.memberId} and m.kind = 'human'
           )
           and exists (
             select 1 from access_group_memberships gm
              where gm.group_id = g.id
                and gm.member_id = ${input.memberId}
                and gm.deleted_at is null
           )
         )
       )
  )`;
}

/** What one subject-type resolver hands back: the context it maps to. */
export interface SubjectContext {
  readonly contextId: string;
}

type SubjectResolver = <
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  subjectId: string,
  workspaceId: string,
) => Promise<SubjectContext | undefined>;

/**
 * Resolves a resource straight to its own context: what
 * `ensureContext({ resourceType, ... })` created for it. Most subject types
 * resolve this way; a sub-resource that inherits its parent's context
 * instead (a comment, a check-in) gets its own resolver that looks the
 * parent up rather than sharing this one.
 */
const ownContextResolver = (resourceType: string): SubjectResolver => {
  return async (tx, subjectId, workspaceId) => {
    const [row] = await tx
      .select({ id: accessContexts.id })
      .from(accessContexts)
      .where(
        activeOnly(
          accessContexts,
          eq(accessContexts.workspaceId, workspaceId),
          eq(accessContexts.resourceType, resourceType),
          eq(accessContexts.resourceId, subjectId),
        ),
      )
      .limit(1);
    return row ? { contextId: row.id } : undefined;
  };
};

/**
 * The subject-to-context resolver (TECHNICAL-PLAN §4.1, "sub-resources
 * inherit"). Exhaustive and fail-closed: a subject type absent from this map
 * raises rather than defaulting to some context, so a new subject type
 * cannot ship unsecured by omission. `workspace` and `blob` came from Phase 1
 * and 2, `space` from P3-T01; comments, check-ins, reactions and votes each
 * add their own entry as they land, resolving through their parent's context
 * rather than owning one.
 */
const SUBJECT_RESOLVERS: Record<string, SubjectResolver> = {
  workspace: ownContextResolver("workspace"),
  blob: ownContextResolver("blob"),
  space: ownContextResolver("space"),
  // P3-T04. A key result is deliberately absent: it inherits its goal's context,
  // and its callers resolve the owning goal first so the not-found answer covers
  // "no such key result" and "not yours to see" identically.
  goal: ownContextResolver("goal"),
  // P5-T10a. An initiative owns a context so its owner can hold `full` on the
  // work without holding it on the whole space.
  initiative: ownContextResolver("initiative"),
  // P5-T11. A task owns a context so an assignee holds edit on that one task
  // and nothing else. TECHNICAL-PLAN §4.9: assignment grants edit access
  // through the member's group.
  task: ownContextResolver("task"),
  // P5-T12. A document has no context of its own: it is readable by whoever
  // reads its subject, and the draft rule in `actions/documents.ts` is the only
  // thing that narrows it further. Registered so a comment on a document
  // resolves, because `comment` walks its parent's resolver.
  document: async (tx, subjectId, workspaceId) => {
    const [row] = await tx
      .select({
        subjectType: documents.subjectType,
        subjectId: documents.subjectId,
      })
      .from(documents)
      .where(
        activeOnly(
          documents,
          eq(documents.workspaceId, workspaceId),
          eq(documents.id, subjectId),
        ),
      )
      .limit(1);
    if (!row) {
      return undefined;
    }
    // A key result has no resolver of its own; its goal is what decides.
    if (row.subjectType === "key_result") {
      const goal = await tx.execute<{ goal_id: string }>(
        sql`select goal_id from key_results
             where id = ${row.subjectId}
               and workspace_id = ${workspaceId}
               and deleted_at is null
             limit 1`,
      );
      const goalId = goal.rows[0]?.goal_id;
      return goalId
        ? SUBJECT_RESOLVERS.goal?.(tx, goalId, workspaceId)
        : undefined;
    }
    // A cycle and a session belong to the workspace as far as access goes.
    const parent =
      row.subjectType === "cycle" || row.subjectType === "session"
        ? "workspace"
        : row.subjectType;
    const resolver = SUBJECT_RESOLVERS[parent];
    return resolver
      ? resolver(
          tx,
          parent === "workspace" ? workspaceId : row.subjectId,
          workspaceId,
        )
      : undefined;
  },
  // P3-T16. Comments and reactions inherit their parent subject's context.
  comment: async (tx, subjectId, workspaceId) => {
    const [row] = await tx
      .select({
        subjectType: comments.subjectType,
        subjectId: comments.subjectId,
      })
      .from(comments)
      .where(
        activeOnly(
          comments,
          eq(comments.workspaceId, workspaceId),
          eq(comments.id, subjectId),
        ),
      )
      .limit(1);
    if (!row) {
      return undefined;
    }
    const parentResolver = SUBJECT_RESOLVERS[row.subjectType];
    return parentResolver
      ? parentResolver(tx, row.subjectId, workspaceId)
      : undefined;
  },
  reaction: async (tx, subjectId, workspaceId) => {
    const [row] = await tx
      .select({
        subjectType: reactions.subjectType,
        subjectId: reactions.subjectId,
      })
      .from(reactions)
      .where(
        activeOnly(
          reactions,
          eq(reactions.workspaceId, workspaceId),
          eq(reactions.id, subjectId),
        ),
      )
      .limit(1);
    if (!row) {
      return undefined;
    }
    const parentResolver = SUBJECT_RESOLVERS[row.subjectType];
    return parentResolver
      ? parentResolver(tx, row.subjectId, workspaceId)
      : undefined;
  },
};

export async function resolveSubjectContext<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  subjectType: string,
  subjectId: string,
  workspaceId: string,
): Promise<SubjectContext | undefined> {
  const resolver = SUBJECT_RESOLVERS[subjectType];
  if (!resolver) {
    throw new Error(
      `No context resolver registered for subject type "${subjectType}". ` +
        `Add one to SUBJECT_RESOLVERS in packages/core/src/access/reads.ts ` +
        `before this subject type can be read.`,
    );
  }
  return resolver(tx, subjectId, workspaceId);
}

/**
 * Whether a subject type has a resolver at all (P6-G07a).
 *
 * `resolveSubjectContext` raises for a type it does not know, and a caller
 * looping over rows of mixed subject types needs to tell "this one is not
 * reachable" from "nobody has taught the getter about this type yet". Those two
 * answers demand opposite handling: the first must hide the row, the second
 * must not, because the types with no resolver are the ones with no context of
 * their own, whose visibility the workspace floor already decides. A check-in,
 * a blocker, a KPI, a session and a cycle are all in that group, and every
 * nudge in the product is about one of them.
 */
export function hasSubjectResolver(subjectType: string): boolean {
  return subjectType in SUBJECT_RESOLVERS;
}

export interface GetAccessScopedInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Defaults to view: the lowest level that makes a resource visible. */
  readonly requires?: AccessLevel;
}

export interface AccessScopedResource {
  readonly contextId: string;
  readonly level: number;
}

/**
 * The mandatory access-aware getter. Resolves `resourceType`/`resourceId` to
 * its context, then the member's level on it, and throws not-found rather
 * than forbidden the moment either comes up short — a missing resource, a
 * suspended member, or a level below `requires` all look identical to the
 * caller, so there is no existence oracle for a resource someone cannot see.
 */
export async function getAccessScoped<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: GetAccessScopedInput,
): Promise<AccessScopedResource> {
  const requires = input.requires ?? ACCESS_LEVELS.view;
  const context = await resolveSubjectContext(
    tx,
    input.resourceType,
    input.resourceId,
    input.workspaceId,
  );
  const notFound = () =>
    new OperationError(
      "not_found",
      `No such ${input.resourceType}, or you do not have access to it.`,
    );
  if (!context) {
    throw notFound();
  }
  const level = await resolveMemberAccessLevel(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    contextId: context.contextId,
  });
  if (level < requires) {
    throw notFound();
  }
  return { contextId: context.contextId, level };
}

export interface VisibleIdsInput {
  readonly workspaceId: string;
  readonly memberId: string;
  /** A type that owns its own context: `goal`, `initiative`, `task`, `space`. */
  readonly resourceType: string;
  readonly ids: readonly string[];
  /** Defaults to view. */
  readonly requires?: number;
}

/**
 * The subset of `ids` the member may see, decided in one statement (P7-T01b).
 *
 * **Why this exists.** A list of protected aggregates cannot be trusted from
 * its own query: §4.1 sends every read through the getter, so `goals.list`,
 * `tasks.list` and `initiatives.list` each called `getAccessScoped` once per
 * row. That is correct and it is an N+1. The query-count budget P7-T01a added
 * measured it: `goals.list` cost 15 statements at five goals and 105 at fifty,
 * two per row, because the getter resolves the context and then the level. At
 * §13.1's hundred thousand goals that is two hundred thousand round trips for
 * one page.
 *
 * **What it does not change.** The rules are `resolveMemberAccessLevel`'s,
 * copied deliberately rather than approximated: the same actor test, the same
 * three group tiers, the same restriction of the two blanket tiers to a human
 * member so an agent or a guest inherits nothing. A row whose context is
 * missing is absent from the answer, which is the set-shaped form of the
 * getter's not-found. The one thing that changes is the number of round trips.
 *
 * **Own-context types only.** A sub-resource that inherits a parent's context
 * (a comment, a check-in) is not resolvable this way and its caller resolves
 * the parent first, exactly as it does today. `SUBJECT_RESOLVERS` says which
 * types own a context; passing another one returns nothing rather than
 * guessing, and the caller keeps the per-row path.
 */
export async function visibleResourceIds<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: VisibleIdsInput): Promise<Set<string>> {
  if (input.ids.length === 0) {
    return new Set();
  }
  const requires = input.requires ?? ACCESS_LEVELS.view;
  const result = await tx.execute<{ resource_id: string }>(sql`
    with actor as (
      select kind from workspace_members
       where id = ${input.memberId}
         and workspace_id = ${input.workspaceId}
         and status = 'active'
         and deleted_at is null
    )
    select c.resource_id
      from access_contexts c
      join access_bindings b
        on b.context_id = c.id
       and b.workspace_id = ${input.workspaceId}
       and b.deleted_at is null
      join access_groups g
        on g.id = b.group_id
       and g.deleted_at is null
       and g.workspace_id = ${input.workspaceId}
     where c.workspace_id = ${input.workspaceId}
       and c.resource_type = ${input.resourceType}
       and c.deleted_at is null
       -- sql.param, not the bare array: Drizzle expands a plain array into a
       -- row of values, which Postgres then refuses to cast to uuid[].
       and c.resource_id = any(${sql.param([...input.ids])}::uuid[])
       and exists (select 1 from actor)
       and (
         (g.kind = 'member' and g.member_id = ${input.memberId})
         or (
           g.kind = 'workspace_standard'
           and exists (select 1 from actor where kind = 'human')
         )
         or (
           g.kind = 'space_standard'
           and exists (select 1 from actor where kind = 'human')
           and exists (
             select 1 from access_group_memberships gm
              where gm.group_id = g.id
                and gm.member_id = ${input.memberId}
                and gm.deleted_at is null
           )
         )
       )
     group by c.resource_id
    having max(b.level) >= ${requires}
  `);
  return new Set(result.rows.map((row) => row.resource_id));
}

/**
 * Refuses a read whose declared level the caller does not hold (P6-G31).
 *
 * **`access` on a read action recorded a requirement and nothing checked it.**
 * Not `defineReadAction`, not `callAction`, not the REST, agent or chat
 * transports, which take it only as the name of a scope. Twenty-nine reads
 * declared above `view` and two enforced it, so over REST an ordinary member's
 * token reached the AI budgets, the channel message log, every agent run, the
 * nudge volume and the import history. In the browser the admin layout refuses
 * first, which is why the screens looked right and the surface underneath did
 * not. Found while writing `invitations.list` at P6-G06a.
 *
 * **The workspace context, not the resource.** These are workspace-wide reads:
 * an administrative card, an AI setting, a channel connection. A read whose
 * rows are themselves access-scoped goes through `getAccessScoped` per row
 * instead and declares `view`, because the getter is what decides there.
 *
 * **`not_found`, in the getter's own words, and not `forbidden`.** A read
 * refuses the way `getAccessScoped` refuses, so that a stranger, a suspended
 * member and a member below the level are told the same thing. `forbidden`
 * would have been defensible for a caller who is already a member and knows
 * the workspace exists, and it is what the write actions beside these reads
 * raise; it is not defensible for a caller with no member row at all, because
 * "you hold too little access in this workspace" confirms the workspace.
 * One check cannot tell the two apart without handing back the oracle it is
 * there to close, so it says the safer thing to both. Two existing specs, in
 * `settings-actions.test.ts` and `import-table.test.ts`, already required
 * this, and they are what caught the first version of this function.
 *
 * The action's own name is not in the message, for the same reason: it would
 * name the thing the caller may not reach. The caller knows which read it
 * called, so nothing is lost that the caller did not already have.
 *
 * A `system` or `operator` actor passes, matching `runOperation`: a clock and a
 * maintenance command have no member to resolve and full trust by construction.
 */
export async function requireWorkspaceLevel(
  tx: WorkspaceTx,
  workspaceId: string,
  actor: {
    readonly kind: string;
    readonly userId?: string;
    readonly memberId?: string;
  },
  required: number,
): Promise<void> {
  if (actor.kind === "system" || actor.kind === "operator") {
    return;
  }

  const refuse = (): never => {
    throw new OperationError(
      "not_found",
      "No such workspace, or you do not have access to it.",
    );
  };

  const memberId =
    actor.memberId ?? (await memberIdForUser(tx, workspaceId, actor.userId));
  if (!memberId) {
    refuse();
  }

  const context = await resolveSubjectContext(
    tx,
    "workspace",
    workspaceId,
    workspaceId,
  );
  if (!context) {
    refuse();
  }

  const level = await resolveMemberAccessLevel(tx, {
    workspaceId,
    memberId: memberId as string,
    contextId: (context as { contextId: string }).contextId,
  });
  if (level < required) {
    refuse();
  }
}

/** The acting member's id, or null when the user is not an active member. */
async function memberIdForUser(
  tx: WorkspaceTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string | null> {
  if (!userId) {
    return null;
  }
  const result = await tx.execute<{ id: string }>(sql`
    select id from workspace_members
     where workspace_id = ${workspaceId}
       and user_id = ${userId}
       and status = 'active'
       and deleted_at is null
     limit 1
  `);
  return result.rows[0]?.id ?? null;
}
