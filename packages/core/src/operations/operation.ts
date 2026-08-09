/**
 * The Operation pipeline: layer 3 of TECHNICAL-PLAN §8.1.
 *
 * Every mutation in the product runs through here. One transaction covers the
 * domain change, the activity row, the audit row and any outbox rows, so:
 *
 *   - there are no partial writes,
 *   - the audit trail cannot drift from the state it describes,
 *   - a side effect never fires for a change that rolled back.
 *
 * **Why the audit row is a return value.** `execute` must hand back its audit
 * and activity rows for the operation to compile. There is no shape of
 * operation that changes something and returns nothing, which is what makes
 * "a mutation without its audit row is impossible" a property of the types
 * rather than a rule people remember. The lint in `packages/config` catches
 * writes that never enter the pipeline at all; this catches the rest.
 *
 * **Where authorisation happens.** Against freshly loaded rows, before any
 * write, inside the transaction that will do the writing. The plan says
 * "authorise against freshly loaded, access-scoped rows, then one
 * transaction"; reading that as a separate earlier transaction would open a
 * window where a binding is revoked after the check and the write proceeds
 * anyway. Doing it first inside the same transaction satisfies "freshly
 * loaded" and "before the change", and closes that window. Recorded here
 * because it is a deliberate reading of the sentence, not an accident.
 *
 * **What is still a seam.** `authorise` resolves the actor to an active member
 * and compares the action's declared level. The relationship model behind that
 * comparison is P2-T01 and P2-T02: until then every active member resolves to
 * `full`, so the level check is real machinery over a placeholder answer. It
 * is one function, replaced wholesale, and no handler changes when it is.
 */
import {
  activeOnly,
  activities,
  auditEvents,
  enqueueOutbox,
  type OutboxMessage,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { ACCESS_LEVELS, type AccessLevel } from "../access/levels.ts";
import {
  resolveMemberAccessLevel,
  resolveSubjectContext,
} from "../access/reads.ts";
import { auditRowHash, GENESIS_HASH } from "../audit/chain.ts";
import { OperationError } from "./errors.ts";

/** The transaction handed to an operation's `execute`. */
export type OperationTx = Parameters<
  Parameters<NodePgDatabase<Record<string, never>>["transaction"]>[0]
>[0];

/** Who is asking. `system` is bootstrap work with no member behind it. */
export interface ActorInput {
  readonly kind: "human" | "agent" | "system" | "operator";
  /** Required for a human actor: the global user, resolved to a member. */
  readonly userId?: string;
  /** Required for an agent actor. */
  readonly memberId?: string;
}

/** Who is acting, after resolution against the workspace. */
export interface ResolvedActor {
  readonly kind: ActorInput["kind"];
  readonly memberId: string | null;
  /**
   * A plain number rather than `AccessLevel`: the resolved level can be `0`
   * when the member reaches none of the three tiers on the workspace's own
   * context, and `0` is not one of the four declared levels.
   */
  readonly level: number;
}

export interface ActivityInput {
  readonly kind: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly payload?: Record<string, unknown>;
  readonly spaceId?: string;
  readonly contextId?: string;
}

export interface AuditInput {
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string;
  readonly payload?: Record<string, unknown>;
}

/**
 * What an operation must hand back. Activity and audit are required, which is
 * the whole point.
 */
export interface OperationOutcome<TResult> {
  readonly result: TResult;
  readonly activity: ActivityInput;
  readonly audit: AuditInput;
  readonly outbox?: readonly OutboxMessage[];
}

export interface OperationContext<TLoaded> {
  readonly tx: OperationTx;
  readonly workspaceId: string;
  readonly actor: ResolvedActor;
  readonly loaded: TLoaded;
}

export interface OperationSpec<TResult, TLoaded = undefined> {
  /** The registry action name. Recorded on the audit row. */
  readonly action: string;
  readonly workspaceId: string;
  readonly actor: ActorInput;
  /** The level this operation requires. Defaults to edit. */
  readonly requires?: AccessLevel;
  /**
   * Bootstrap operations create the workspace they run in, so there is no
   * member to authorise and no workspace to load. Only provisioning sets this.
   */
  readonly bootstrap?: boolean;
  /** Freshly loaded rows the authorisation and the change both depend on. */
  readonly load?: (context: {
    tx: OperationTx;
    workspaceId: string;
    actor: ResolvedActor;
  }) => Promise<TLoaded>;
  readonly execute: (
    context: OperationContext<TLoaded>,
  ) => Promise<OperationOutcome<TResult>>;
}

export { OperationError };

export interface OperationDeps {
  readonly pool: Pool;
}

/**
 * Resolves the acting member inside the transaction.
 *
 * Returns not-found rather than forbidden for somebody who is not a member, so
 * the workspace's existence is not something an outsider can probe. Suspended
 * members are excluded here rather than at each call site, because that is the
 * kind of check that gets forgotten exactly once.
 */
async function resolveActor(
  tx: OperationTx,
  workspaceId: string,
  actor: ActorInput,
): Promise<ResolvedActor> {
  if (actor.kind === "system") {
    return { kind: "system", memberId: null, level: ACCESS_LEVELS.full };
  }

  const conditions = actor.memberId
    ? eq(workspaceMembers.id, actor.memberId)
    : actor.userId
      ? eq(workspaceMembers.userId, actor.userId)
      : undefined;

  if (!conditions) {
    throw new OperationError(
      "forbidden",
      "An acting principal needs a user id or a member id.",
    );
  }

  const [member] = await tx
    .select({
      id: workspaceMembers.id,
      status: workspaceMembers.status,
    })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        conditions,
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!member) {
    throw new OperationError(
      "not_found",
      "No such workspace, or you are not a member of it.",
    );
  }
  if (member.status !== "active") {
    // A suspended member is refused everything, and told the same thing an
    // outsider is told.
    throw new OperationError(
      "not_found",
      "No such workspace, or you are not a member of it.",
    );
  }

  // The level an operation compares against is the member's access on the
  // workspace's own context: every protected aggregate in Phase 2 either is
  // the workspace or, once P3-T01 ships spaces, resolves its own context and
  // authorises through that instead via the getter in packages/core/src/
  // access/reads.ts. Provisioning always creates the workspace's context
  // before any member exists, so a missing context here is not expected; it
  // resolves to zero rather than throwing, which a bootstrap-only workspace
  // mid-provisioning would otherwise turn into a crash instead of a refusal.
  const context = await resolveSubjectContext(
    tx,
    "workspace",
    workspaceId,
    workspaceId,
  );
  const level = context
    ? await resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: member.id,
        contextId: context.contextId,
      })
    : 0;

  return { kind: actor.kind, memberId: member.id, level };
}

/**
 * Appends the audit row, chained to this workspace's previous one.
 *
 * The advisory lock is what makes the chain a chain: without it two
 * transactions read the same head and claim the same sequence number, and one
 * of them loses to the unique index after doing all its work. Taken as late as
 * possible, so it is held for the tail of the transaction rather than all of
 * it. This does serialise the end of concurrent writes within one workspace,
 * which is the price of a trail that can be verified. P7-T01 measures it.
 */
async function appendAudit(
  tx: OperationTx,
  workspaceId: string,
  actor: ResolvedActor,
  audit: AuditInput,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`audit:${workspaceId}`}))`,
  );

  const [head] = await tx
    .select({ seq: auditEvents.seq, rowHash: auditEvents.rowHash })
    .from(auditEvents)
    .orderBy(desc(auditEvents.seq))
    .limit(1);

  const row = {
    workspaceId,
    seq: head ? Number(head.seq) + 1 : 1,
    actorMemberId: actor.memberId,
    actorKind: actor.kind,
    action: audit.action,
    targetType: audit.targetType,
    targetId: audit.targetId ?? null,
    payload: audit.payload ?? {},
    at: new Date(),
    prevHash: head ? head.rowHash : GENESIS_HASH,
  };

  await tx.insert(auditEvents).values({ ...row, rowHash: auditRowHash(row) });
}

/**
 * Runs one operation. The only supported way to change anything.
 */
export async function runOperation<TResult, TLoaded = undefined>(
  deps: OperationDeps,
  spec: OperationSpec<TResult, TLoaded>,
): Promise<TResult> {
  const db = drizzle(deps.pool);
  const required = spec.requires ?? ACCESS_LEVELS.edit;

  return withContext(
    db,
    {
      workspaceId: spec.workspaceId,
      ...(spec.actor.userId ? { userId: spec.actor.userId } : {}),
    },
    async (tx) => {
      // 1. Who is asking, resolved against rows loaded in this transaction.
      const actor = spec.bootstrap
        ? ({
            kind: spec.actor.kind,
            memberId: null,
            level: ACCESS_LEVELS.full,
          } satisfies ResolvedActor)
        : await resolveActor(tx, spec.workspaceId, spec.actor);

      // 2. Anything else the decision depends on, freshly loaded.
      const loaded = spec.load
        ? await spec.load({ tx, workspaceId: spec.workspaceId, actor })
        : (undefined as TLoaded);

      // 3. Authorise, before a single write.
      if (actor.level < required) {
        throw new OperationError(
          "forbidden",
          `${spec.action} needs a higher access level than you hold.`,
        );
      }

      // 4. The change itself, plus what it has to record.
      const outcome = await spec.execute({
        tx,
        workspaceId: spec.workspaceId,
        actor,
        loaded,
      });

      // 5. The activity row.
      await tx.insert(activities).values({
        workspaceId: spec.workspaceId,
        kind: outcome.activity.kind,
        payload: outcome.activity.payload ?? {},
        actorMemberId: actor.memberId,
        actorKind: actor.kind,
        subjectType: outcome.activity.subjectType,
        subjectId: outcome.activity.subjectId,
        spaceId: outcome.activity.spaceId ?? null,
        contextId: outcome.activity.contextId ?? null,
        at: new Date(),
      });

      // 6. The audit row, chained.
      await appendAudit(tx, spec.workspaceId, actor, outcome.audit);

      // 7. Side effects, as outbox rows. The relay delivers them after this
      //    transaction commits, so nothing fires for a change that rolls back.
      for (const message of outcome.outbox ?? []) {
        await enqueueOutbox(tx, message);
      }

      return outcome.result;
    },
  );
}
