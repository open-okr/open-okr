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

import { randomUUID } from "node:crypto";
import {
  activeOnly,
  activities,
  auditEvents,
  enqueueOutbox,
  type OutboxMessage,
  withContext,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { ACCESS_LEVELS, type AccessLevel } from "../access/levels.ts";
import {
  resolveMemberAccessLevel,
  resolveSubjectContext,
} from "../access/reads.ts";
import { validateActivityPayload } from "../activities/catalogue.ts";
import { resolveActivityContext } from "../activities/context.ts";
import { fanOutActivity } from "../activities/fanout.ts";
import { auditRowHash, GENESIS_HASH } from "../audit/chain.ts";
import { EMBED_TOPIC, isEmbeddableSubject } from "../embeddings/subjects.ts";
import { INDEX_TOPIC, isIndexableSubject } from "../search/subjects.ts";
import { OperationError } from "./errors.ts";
import { isRecoveryAction } from "./freeze.ts";

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
  /**
   * Opts this activity into notification fan-out (P2-T06, P2-T07): every
   * subscriber to `subjectType`/`subjectId` who still has access and is not
   * the actor gets a notification. Off by default — most activities today
   * have no subscribers to reach yet, and a workspace-level event like a
   * rename is not, on its own, something every member should be notified
   * about.
   */
  readonly notify?: boolean;
  /**
   * Names the content this write changed, so the pipeline enqueues it for
   * embedding (AI-NATIVE-PLAN.md §9, P4-T13a).
   *
   * **Only for writes whose activity points at a container rather than at what
   * changed.** A goal's activity names the goal, so a goal write needs nothing
   * here: the pipeline reads `subjectType` and enqueues by itself. A retro
   * note's activity names the space and a narrative's names the goal, and
   * embedding the container would be embedding the wrong thing, so those writes
   * say what actually changed.
   *
   * Same shape as `notify` above and for the same reason: the mechanism is
   * central so it cannot be implemented inconsistently, and the opt-in is per
   * write because most writes change no embeddable text. Agung chose this on
   * 26 August 2026.
   *
   * Setting it does not mean the text changed. The worker re-reads and hashes,
   * and an unchanged hash embeds nothing.
   */
  readonly embed?: {
    readonly entityType: string;
    readonly entityId: string;
  };
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
   * Bootstrap operations run before the acting person has a member row to
   * resolve — either because the workspace itself doesn't exist yet
   * (`workspace.provision`) or because this operation is what creates their
   * membership (`invitations.acceptLink`, `invitations.joinByTrustedDomain`).
   * `resolveActor` is skipped entirely and the actor is trusted with `full`;
   * the operation's own logic is the whole of what authorises it.
   */
  readonly bootstrap?: boolean;
  /**
   * Where this write came from, when it did not come from the browser
   * (P5-T06a).
   *
   * Merged into the audit payload here rather than by each action, for the
   * reason every cross-cutting fact belongs in one place: `channels.md`'s §7
   * requires "an audit event with the channel named" for *every* inbound
   * action, and forty actions each remembering to add it is forty chances to
   * forget. Absent for a browser write, which is what "no channel" means.
   *
   * The payload is inside the hash chain, so the channel is as tamper-evident
   * as the rest of the row without a migration to the append-only table.
   */
  readonly channel?: string;
  /**
   * A pre-tenant policy key this operation's own transaction needs (P5-T07c-b).
   *
   * Three tables are readable before a workspace is known, each through a second
   * policy key: `channel_installations`, `api_tokens` and
   * `device_authorisations`. Only the last of them is *written* through the
   * pipeline: approving a device login puts a workspace onto a row that has none,
   * and the policy cannot see that row through the tenant setting alone. Absent
   * on every other operation, which is what "this write is about rows that
   * already belong to a workspace" means.
   */
  readonly deviceCodeHash?: string;
  /**
   * Skip notification fan-out for this write (P6-T01a).
   *
   * Set from the call context's bulk flag and by nothing else. §7.1 step 3
   * asks for an import to run through the normal pipeline with notification
   * dispatch suppressed by a bulk flag. Everything else about the write is
   * unchanged, the activity row included, so the feed still shows what the
   * import did.
   */
  readonly suppressNotifications?: boolean;
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
      ...(spec.deviceCodeHash ? { deviceCodeHash: spec.deviceCodeHash } : {}),
    },
    async (tx) => {
      // 0. The freeze overlay (§4.1, §8.2): a workspace that is not `active`
      // collapses to view-only for every write except the recovery list.
      // Checked ahead of everything else, including who is asking — a
      // frozen workspace refuses the write before spending effort on an
      // actor it will not matter to. A workspace with no row yet
      // (`workspace.provision`, mid-transaction) has no state to collapse,
      // so this is silent rather than a special case keyed on `bootstrap`.
      if (!isRecoveryAction(spec.action)) {
        const [current] = await tx
          .select({ state: workspaces.state })
          .from(workspaces)
          .where(activeOnly(workspaces, eq(workspaces.id, spec.workspaceId)))
          .limit(1);
        if (current && current.state !== "active") {
          throw new OperationError(
            "forbidden",
            current.state === "frozen"
              ? "This workspace is frozen. Only member and settings management is allowed until it is reactivated."
              : "This workspace is read-only. Only member and settings management is allowed until it is reactivated.",
          );
        }
      }

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

      // 5. The activity row. A kind outside the catalogue, or a payload that
      //    does not match its own kind's schema, refuses here rather than
      //    persisting — this is what makes "an event kind outside the
      //    catalogue cannot be persisted" true of every write path at once
      //    instead of every call site having to remember its own check.
      const activityPayload = outcome.activity.payload ?? {};
      validateActivityPayload(outcome.activity.kind, activityPayload);
      const contextId =
        outcome.activity.contextId ??
        (await resolveActivityContext(
          tx,
          spec.workspaceId,
          outcome.activity.subjectType,
          outcome.activity.subjectId,
        ));
      const [insertedActivity] = await tx
        .insert(activities)
        .values({
          workspaceId: spec.workspaceId,
          kind: outcome.activity.kind,
          payload: activityPayload,
          actorMemberId: actor.memberId,
          actorKind: actor.kind,
          subjectType: outcome.activity.subjectType,
          subjectId: outcome.activity.subjectId,
          spaceId: outcome.activity.spaceId ?? null,
          contextId: contextId ?? null,
          at: new Date(),
        })
        .returning({ id: activities.id });

      if (outcome.activity.notify && !spec.suppressNotifications) {
        await fanOutActivity(tx, {
          workspaceId: spec.workspaceId,
          activityId: (insertedActivity as { id: string }).id,
          subjectType: outcome.activity.subjectType,
          subjectId: outcome.activity.subjectId,
          actorMemberId: actor.memberId,
        });
      }

      // 6. The audit row, chained. The channel is merged in here, once, so
      //    "she checked in from Slack" is answerable for every action rather
      //    than only for the ones whose author remembered (P5-T06a).
      await appendAudit(tx, spec.workspaceId, actor, {
        ...outcome.audit,
        ...(spec.channel
          ? {
              payload: {
                ...(outcome.audit.payload ?? {}),
                channel: spec.channel,
              },
            }
          : {}),
      });

      // 7. Side effects, as outbox rows. The relay delivers them after this
      //    transaction commits, so nothing fires for a change that rolls back.
      for (const message of outcome.outbox ?? []) {
        await enqueueOutbox(tx, message);
      }

      /**
       * 8. The embedding job, as one more outbox row (P4-T13a).
       *
       * Here rather than in each action, because an enqueue that every write has
       * to remember is an enqueue the ninth content kind will forget. Two ways in:
       * the activity's own subject is embeddable, or the write named the content
       * explicitly because its activity points at a container.
       *
       * The key carries a timestamp, so it never collides. Coalescing to one
       * pending row per entity was the first idea and was wrong: a second edit
       * arriving while the relay holds the first row would collide on the unique
       * key, and a failed enqueue inside this transaction would roll back a
       * legitimate domain write. Duplicate rows are the cheaper mistake, because
       * the worker's hash check makes the second one a no-op.
       */
      const embedTarget =
        outcome.activity.embed ??
        (isEmbeddableSubject(outcome.activity.subjectType)
          ? {
              entityType: outcome.activity.subjectType,
              entityId: outcome.activity.subjectId,
            }
          : null);
      if (embedTarget) {
        await enqueueOutbox(tx, {
          topic: EMBED_TOPIC,
          payload: {
            workspaceId: spec.workspaceId,
            entityType: embedTarget.entityType,
            entityId: embedTarget.entityId,
          },
          idempotencyKey: `${EMBED_TOPIC}:${embedTarget.entityType}:${embedTarget.entityId}:${Date.now()}:${randomUUID()}`,
        });
      }

      /**
       * 9. The search indexing job, beside the embedding one (P5-T13).
       *
       * The same trigger and the same shape, from the same place, so the two
       * indexes are refreshed by the same write and cannot come to disagree
       * about what exists. The sets differ because the questions differ: a KPI,
       * an initiative, a task and a session are searchable and hold no prose
       * worth embedding.
       */
      const indexTarget =
        outcome.activity.embed ??
        (isIndexableSubject(outcome.activity.subjectType)
          ? {
              entityType: outcome.activity.subjectType,
              entityId: outcome.activity.subjectId,
            }
          : null);
      if (indexTarget) {
        await enqueueOutbox(tx, {
          topic: INDEX_TOPIC,
          payload: {
            workspaceId: spec.workspaceId,
            entityType: indexTarget.entityType,
            entityId: indexTarget.entityId,
          },
          // A timestamp and a fresh identifier, for the reason the embedding
          // key above records: coalescing to one pending row per entity
          // collides the moment a second edit arrives while the relay holds
          // the first, and a failed enqueue would roll back a real write.
          idempotencyKey: `${INDEX_TOPIC}:${indexTarget.entityType}:${indexTarget.entityId}:${Date.now()}:${randomUUID()}`,
        });
      }

      return outcome.result;
    },
  );
}
