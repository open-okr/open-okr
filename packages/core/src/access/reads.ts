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
