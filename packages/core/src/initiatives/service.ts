/**
 * Initiative writes, as helpers an Operation's `execute` calls
 * (TECHNICAL-PLAN §4.9, METHOD.md §5.5, P5-T10a).
 *
 * **What an initiative's access context holds.** An initiative owns one context,
 * and three principals reach it:
 *
 * | Principal | Level | Why |
 * |---|---|---|
 * | `workspace_standard` | view | Alignment reads across spaces: a key result in one space is moved by work in another, and a reader who cannot see the initiative sees a measure with nothing behind it |
 * | The owning space's `space_standard` | edit | Working in the space is working on its projects |
 * | The owner's own group | full | Somebody is accountable for the work, and owning it includes ending it |
 *
 * That is the goal's own table with one row fewer. An initiative has no reviewer,
 * because §5.5 asks who will do the work and not who signs it off.
 *
 * It inherits the goal's own open question with it, and it is worth stating out
 * loud rather than discovering: `initiatives.delete` needs `full` at the
 * workspace **and** `full` on the initiative's context, so an initiative whose
 * owner is suspended has nobody left who can remove it. A workspace
 * administrator holds nothing here by virtue of being one, which is the rule
 * spaces and goals already follow.
 *
 * **A context of its own rather than the space's.** Inheriting the space would be
 * one table row cheaper and would make the owner's `full` binding impossible to
 * express: it would have to bind on the space, which would hand them the whole
 * space. It also gives P5-T11's assignment somewhere to bind, since a task
 * inherits its initiative's context the way a key result inherits its goal's.
 *
 * **Derived columns are not written here.** `progress_pct` belongs to the tasks
 * that arrive at P5-T11. An initiative created here reads 0% and stays there
 * until there is work to count.
 */
import {
  activeOnly,
  type CapacityVerdict,
  type InitiativeStatus,
  includeDeleted,
  initiativeKeyResults,
  initiatives,
  keyResults,
  newId,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
  ensureSpaceStandardGroup,
  ensureWorkspaceStandardGroup,
  unbindGroup,
} from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { type LegacyKey, legacyColumns } from "../imports/legacy.ts";
import { OperationError } from "../operations/operation.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/**
 * `numeric` comes back from the driver as a string. Every read of one goes
 * through here, for the reason `goals/service.ts` records: a string compared
 * against a number is a bug this repository has already shipped once.
 */
export const asNumber = (value: string | number | null): number | null => {
  if (value === null) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface CreateInitiativeInput {
  readonly workspaceId: string;
  readonly spaceId: string;
  readonly title: string;
  readonly description?: unknown;
  readonly ownerId: string;
  readonly startsOn?: string | null;
  readonly endsOn?: string | null;
  readonly status?: InitiativeStatus;
  readonly confidence?: number | null;
  readonly capacity?: CapacityVerdict | null;
  readonly position?: number;
  /** The source-system identity, when an import created this row (P6-T01a). */
  readonly legacy?: LegacyKey;
}

export interface CreatedInitiative {
  readonly id: string;
  readonly title: string;
  readonly contextId: string;
}

/**
 * The member who may own work, or not-found.
 *
 * **An agent is refused, and that is not a technicality.** An owner is who is
 * accountable for the work and who holds `full` on its context, and neither is
 * a thing an agent can be: AI-NATIVE-PLAN.md §1.3 gives an agent named bindings
 * and no standing authority. Every workspace ships with two agent members, so
 * without this the Coach and the Champion sit in every owner picker. A
 * placeholder is refused for the plainer reason that nobody has claimed it yet,
 * and a guest because a guest is somebody outside the organisation.
 *
 * Found by opening the screen rather than by reading it: `people.directory`
 * answers with every active member, so the picker offered "OKR Coach" as
 * somebody who could own a project.
 */
async function requireMember<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, memberId: string): Promise<void> {
  const [row] = await tx
    .select({ id: workspaceMembers.id, kind: workspaceMembers.kind })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.id, memberId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new OperationError("not_found", "No such member.");
  }
  // **A placeholder is a person, and an agent is not (P6-T04a).** The rule
  // this enforces is AI-NATIVE-PLAN §1.3's: an agent proposes work and does
  // not carry it. Reading it as "human only" also excluded the imported
  // placeholder, which stands for somebody who owned this very work in the
  // system being replaced and has simply not signed in yet. A guest stays
  // excluded: they are outside the workspace by definition.
  if (row.kind !== "human" && row.kind !== "placeholder") {
    throw new OperationError(
      "forbidden",
      "An initiative is owned by a person. An agent proposes work; it does not carry it, and nor does a guest.",
    );
  }
}

export async function createInitiativeInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: CreateInitiativeInput,
): Promise<CreatedInitiative> {
  await requireMember(tx, input.workspaceId, input.ownerId);

  const initiativeId = newId();
  // openokr:allow-mutation: runs on the transaction the calling Operation
  // opened, so the row commits with its activity, audit and outbox rows.
  const [row] = await tx
    .insert(initiatives)
    .values({
      id: initiativeId,
      workspaceId: input.workspaceId,
      spaceId: input.spaceId,
      title: input.title.trim(),
      description: (input.description ?? null) as never,
      descriptionVersion:
        input.description === undefined || input.description === null
          ? null
          : RICH_TEXT_SCHEMA_VERSION,
      ownerId: input.ownerId,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
      status: input.status ?? "planned",
      confidence:
        input.confidence === null || input.confidence === undefined
          ? null
          : String(input.confidence),
      capacity: input.capacity ?? null,
      position: input.position ?? 0,
      ...legacyColumns(input.legacy),
    })
    .returning({ id: initiatives.id, title: initiatives.title });

  if (!row) {
    throw new Error("The initiative insert returned no row.");
  }

  const contextId = await ensureContext(tx, {
    workspaceId: input.workspaceId,
    resourceType: "initiative",
    resourceId: initiativeId,
  });

  const workspaceStandardGroupId = await ensureWorkspaceStandardGroup(tx, {
    workspaceId: input.workspaceId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId: workspaceStandardGroupId,
    contextId,
    level: ACCESS_LEVELS.view,
  });

  const spaceStandardGroupId = await ensureSpaceStandardGroup(tx, {
    workspaceId: input.workspaceId,
    spaceId: input.spaceId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId: spaceStandardGroupId,
    contextId,
    level: ACCESS_LEVELS.edit,
  });

  await bindOwner(tx, {
    workspaceId: input.workspaceId,
    contextId,
    memberId: input.ownerId,
  });

  return { id: row.id, title: row.title, contextId };
}

/**
 * The owner's own binding.
 *
 * **Untagged, unlike a goal's champion.** The tag column carries a fixed set of
 * five role names in the database's own check constraint, and an initiative's
 * owner is not one of them. Adding a sixth would be a schema change for a
 * capability nothing needs: the review inbox finds a reviewer by tag because it
 * has no column to find them by, and an initiative has `owner_id`. The
 * reassignment below finds this binding by the member's own group, which is what
 * it is keyed on anyway.
 */
async function bindOwner<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    workspaceId: string;
    contextId: string;
    memberId: string;
  },
): Promise<void> {
  const groupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId,
    contextId: input.contextId,
    level: ACCESS_LEVELS.full as never,
  });
}

/**
 * Moving ownership is a rebind, not a column update.
 *
 * The same shape `goals.reassignRole` uses, and for the same reason: an owner
 * column changed without the binding leaves the old owner holding `full` on
 * something that is no longer theirs.
 */
export async function reassignInitiativeOwnerInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    workspaceId: string;
    initiativeId: string;
    contextId: string;
    fromMemberId: string;
    toMemberId: string;
  },
): Promise<void> {
  if (input.fromMemberId === input.toMemberId) {
    return;
  }
  await requireMember(tx, input.workspaceId, input.toMemberId);

  const previousGroupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.fromMemberId,
  });
  await unbindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId: previousGroupId,
    contextId: input.contextId,
  });
  await bindOwner(tx, {
    workspaceId: input.workspaceId,
    contextId: input.contextId,
    memberId: input.toMemberId,
  });
}

/**
 * Links one initiative to one key result, or does nothing when it is already
 * linked.
 *
 * Idempotent rather than an error, because §5.5 is about recording what moves a
 * number and recording it twice is the same statement. A soft-deleted link is
 * revived rather than duplicated, so the unique index holds.
 */
export async function linkKeyResultInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    workspaceId: string;
    initiativeId: string;
    keyResultId: string;
  },
): Promise<{ readonly linked: boolean }> {
  const [keyResult] = await tx
    .select({ id: keyResults.id })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, input.workspaceId),
        eq(keyResults.id, input.keyResultId),
      ),
    )
    .limit(1);
  if (!keyResult) {
    throw new OperationError("not_found", "No such key result.");
  }

  const [existing] = await tx
    .select({
      id: initiativeKeyResults.id,
      deletedAt: initiativeKeyResults.deletedAt,
    })
    .from(initiativeKeyResults)
    .where(
      // Deleted rows on purpose: the unique index covers live rows only, so a
      // link that was removed has to be revived rather than inserted beside.
      includeDeleted(
        initiativeKeyResults,
        eq(initiativeKeyResults.workspaceId, input.workspaceId),
        eq(initiativeKeyResults.initiativeId, input.initiativeId),
        eq(initiativeKeyResults.keyResultId, input.keyResultId),
      ),
    )
    .limit(1);

  if (existing && existing.deletedAt === null) {
    return { linked: false };
  }

  if (existing) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(initiativeKeyResults)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        includeDeleted(
          initiativeKeyResults,
          eq(initiativeKeyResults.id, existing.id),
        ),
      );
    return { linked: true };
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx.insert(initiativeKeyResults).values({
    id: newId(),
    workspaceId: input.workspaceId,
    initiativeId: input.initiativeId,
    keyResultId: input.keyResultId,
  });
  return { linked: true };
}

/** Removes one link, or does nothing when there is none. */
export async function unlinkKeyResultInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    workspaceId: string;
    initiativeId: string;
    keyResultId: string;
  },
): Promise<{ readonly unlinked: boolean }> {
  const [existing] = await tx
    .select({ id: initiativeKeyResults.id })
    .from(initiativeKeyResults)
    .where(
      activeOnly(
        initiativeKeyResults,
        eq(initiativeKeyResults.workspaceId, input.workspaceId),
        eq(initiativeKeyResults.initiativeId, input.initiativeId),
        eq(initiativeKeyResults.keyResultId, input.keyResultId),
      ),
    )
    .limit(1);
  if (!existing) {
    return { unlinked: false };
  }
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(initiativeKeyResults)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      activeOnly(
        initiativeKeyResults,
        eq(initiativeKeyResults.id, existing.id),
      ),
    );
  return { unlinked: true };
}
