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
import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { ACCESS_LEVELS, type AccessLevel } from "../access/levels.ts";
import {
  hasSubjectResolver,
  resolveMemberAccessLevel,
  resolveSubjectContext,
} from "../access/reads.ts";
import { validateActivityPayload } from "../activities/catalogue.ts";
import { resolveActivityContext } from "../activities/context.ts";
import { fanOutActivity } from "../activities/fanout.ts";
import { feedAddedEvent } from "../activities/live.ts";
import { EMBED_TOPIC, isEmbeddableSubject } from "../embeddings/subjects.ts";
import { INDEX_TOPIC, isIndexableSubject } from "../search/subjects.ts";
import {
  defaultMetrics,
  METRIC,
  type MetricRecorder,
  OUTCOME,
  type Outcome,
} from "../telemetry/recorder.ts";
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
   * What this operation is about, when the action knows before it runs
   * (P6-G13c).
   *
   * **A level on this clears the access floor, as a level on the workspace
   * does.** `resolveActor` resolves a level on the workspace's own context,
   * and the comment beside the floor says the floor is coarse because
   * per-resource authorisation happens inside through `getAccessScoped`.
   * Those two sentences disagreed: a level on the workspace is not a coarse
   * version of "may this actor act on this thing", it is a different
   * question. The floor now accepts an answer to either.
   *
   * It never bit a human. Every active member holds `edit` on the workspace's
   * own context through `workspace_standard`, so the floor passed for
   * everybody and the real check was the one inside. It bit agents, which get
   * bindings on named spaces, goals and KPI trees only: an agent bound to one
   * space at level 100 was refused `spaces.update` on that same space, which
   * made `scoped_direct` a mode no agent could act in (P6-G13b).
   *
   * **A destructive action does not declare one, on purpose.** A delete asks
   * two gates, `full` on the workspace and `full` on the row, and declaring
   * the subject collapses the first into the second: the owner of a thing
   * could then delete it without holding anything else. `initiatives.test.ts`
   * has said so since P5-T10a, that owning a thing does not make somebody
   * able to delete things, and loosening it is an access decision rather than
   * a side effect of this field.
   *
   * **Optional, and the fallback is the old behaviour.** The floor is checked
   * before `execute` runs and most subjects are only known after it returns,
   * so an action declares this only when its own input already carries the
   * answer. An action that does not is measured against the workspace exactly
   * as before, which is why this change moves no existing test.
   */
  readonly subject?: {
    readonly type: string;
    readonly id: string;
  };
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
/**
 * The level the floor compares against (P6-G13c).
 *
 * The actor's own resolved level is the workspace one and stays on
 * `ResolvedActor`, because the activity and audit rows are about the actor
 * rather than about this comparison. This is only the floor's input.
 */
async function floorLevel(
  tx: OperationTx,
  spec: {
    readonly workspaceId: string;
    readonly subject?: { readonly type: string; readonly id: string };
  },
  actor: ResolvedActor,
): Promise<number> {
  if (!spec.subject || actor.memberId === null) {
    // No subject to measure against, or an actor with no member row: a
    // system or bootstrap actor already holds `full` and a human without a
    // member row was refused in `resolveActor`.
    return actor.level;
  }
  if (!hasSubjectResolver(spec.subject.type)) {
    return actor.level;
  }

  const context = await resolveSubjectContext(
    tx,
    spec.subject.type,
    spec.subject.id,
    spec.workspaceId,
  );
  if (!context) {
    // The subject does not exist, or is not this workspace's. The action's own
    // load or execute answers that with not-found, which is the right answer
    // and a better message than the floor's.
    return actor.level;
  }

  const onSubject = await resolveMemberAccessLevel(tx, {
    workspaceId: spec.workspaceId,
    memberId: actor.memberId,
    contextId: context.contextId,
  });

  // **The higher of the two, not the subject's instead of the workspace's.**
  //
  // The design said "measure against the subject" and replacing one with the
  // other is the wrong reading of it. Replacement narrows the floor for
  // everybody who holds the workspace and not this row, and that answer is
  // worse in two ways: it moves refusals that `getAccessScoped` answers with
  // `not_found` to a `forbidden` from the floor, which tells a caller the row
  // exists, and it changes how existing writes are authorised, which the
  // design says it does not do.
  //
  // Taking the maximum adds a way to pass the floor and removes none. An
  // agent bound to one space at 100 now clears it for a write in that space;
  // every actor who cleared it before still does; and the real check inside
  // is unchanged and remains the one that decides.
  return Math.max(actor.level, onSubject);
}

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
 * Appends the audit row. Its position in the chain is filled in later.
 *
 * **This used to take `pg_advisory_xact_lock('audit:' || workspace_id)` for
 * the tail of every write**, so the row could read the workspace's head and
 * commit to it. That made the chain a chain and it serialised the end of every
 * concurrent write in one workspace. P7-T02 measured the cost: at ten
 * concurrent members every scenario is inside its §13.1 budget, and at fifty
 * the reads degrade one to two and a half times while the write degrades
 * thirty, to 14.8 seconds at the 95th percentile, with throughput barely
 * moving. A queue, not a shortage of capacity.
 *
 * Agung chose on 10 September 2026 to move the chaining out rather than take
 * the recorded sequence-and-retry fallback, which would have swapped a lock
 * for a retry storm under exactly the contention that was measured.
 *
 * **What did not move.** The row is still written in the same transaction as
 * the change it records, with the same actor, action, target and payload.
 * Whether an event is recorded is unchanged and still atomic. Only its
 * position in the chain is deferred, to `audit/chainer.ts`, which is a single
 * writer per workspace and so needs no coordination with anybody.
 *
 * **The window is real.** Between this insert and the chainer's next pass the
 * row is recorded and not yet committed to, so tampering in that window would
 * not break a hash. `verifyWorkspaceChain` counts those rows as pending and
 * never as verified, which is the honest half of the trade.
 */
async function appendAudit(
  tx: OperationTx,
  workspaceId: string,
  actor: ResolvedActor,
  audit: AuditInput,
): Promise<void> {
  await tx.insert(auditEvents).values({
    workspaceId,
    seq: null,
    actorMemberId: actor.memberId,
    actorKind: actor.kind,
    action: audit.action,
    targetType: audit.targetType,
    targetId: audit.targetId ?? null,
    payload: audit.payload ?? {},
    at: new Date(),
    prevHash: null,
    rowHash: null,
  });
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

  // **Measured around the transaction, not around the action** (P7-T06a,
  // wired here at P7-T06c). `callAction` already times the whole call; this
  // is the part inside `BEGIN` and `COMMIT`. The two apart are what tell an
  // operator whether a slow save is slow in the database or slow before it
  // got there, and that is the only question the pair answers that either
  // one alone does not.
  const metrics = defaultMetrics();
  const startedAt = performance.now();
  const operationOutcome: Outcome = OUTCOME.ok;

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
      //
      // Against the workspace, or against the subject when the action named
      // one and its type has a resolver, whichever is higher (P6-G13c). A
      // subject whose type nothing resolves falls back rather than refusing:
      // the fallback is the behaviour every action had before this existed,
      // and turning an unresolvable type into a refusal would break writes
      // that have nothing to do with this change.
      const level = await floorLevel(tx, spec, actor);
      if (level < required) {
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

      /**
       * The feed's own live insert (P6-G11c).
       *
       * Here rather than in each action, for the reason the embedding job
       * two blocks down gives: an enqueue every write has to remember is an
       * enqueue the next write will forget. Every activity is a feed row, so
       * every activity announces itself.
       *
       * Unconditional on `notify`. That flag decides whether anybody is
       * *messaged*, and a feed is not a message: an activity nobody is
       * subscribed to still belongs on the space's and the workspace's feed.
       * `suppressNotifications` is not consulted for the same reason, with
       * one exception below.
       *
       * **An import is the exception.** `suppressDispatch` exists because a
       * run writes thousands of rows, and a thousand pings would make every
       * open feed in the workspace re-render a thousand times while saying
       * nothing a single refresh at the end would not. An import's rows are
       * on the feed either way, from the first navigation after it.
       */
      if (!spec.suppressNotifications) {
        await enqueueOutbox(
          tx,
          feedAddedEvent({
            workspaceId: spec.workspaceId,
            activityId: (insertedActivity as { id: string }).id,
            actorMemberId: actor.memberId,
          }),
        );
      }

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
  ).then(
    (result) => {
      recordOperation(metrics, spec.action, operationOutcome, startedAt);
      return result;
    },
    (error: unknown) => {
      // A throw out of `withContext` is a rollback: the domain change, the
      // activity row, the audit row and the outbox row all went back
      // together, which is the pipeline's whole promise. Counted as such.
      recordOperation(
        metrics,
        spec.action,
        error instanceof OperationError
          ? error.code === "forbidden"
            ? OUTCOME.refused
            : OUTCOME.notFound
          : OUTCOME.error,
        startedAt,
      );
      throw error;
    },
  );
}

function recordOperation(
  metrics: MetricRecorder,
  action: string,
  outcome: Outcome,
  startedAt: number,
): void {
  metrics.count(METRIC.operationsTotal, { action, outcome });
  metrics.observe(
    METRIC.operationDuration,
    (performance.now() - startedAt) / 1000,
    { action },
  );
}
