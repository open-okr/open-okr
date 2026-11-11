/**
 * Erasing one member in one workspace: the body `people.erase` runs, and the
 * one a person's own deletion runs in each workspace they belong to
 * (docs/design/account-deletion.md §3.3, plan 0.8.0 Y7).
 *
 * **One function, two callers, so there is no second way to do half of it.**
 * An administrator's `people.erase` and the scheduler's run of a deletion the
 * person asked for both call `loadMemberForErasure` and then
 * `eraseMemberInTx`, inside the Operation they each open. What differs is who
 * asked, which the caller writes on its own activity and audit rows.
 *
 * The rule erasure follows (Agung, 11 September 2026): what the person wrote
 * stays, attributed to the placeholder identity, and what identifies them
 * goes. The audit chain still verifies.
 */
import { activeOnly, type WorkspaceTx, workspaceMembers } from "@openokr/db";
import { eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { OperationError } from "../operations/errors.ts";
import {
  type AccountErasure,
  type ErasureSweep,
  eraseAccountIfAlone,
  sweepPersonalData,
} from "./erasure.ts";
import { buildPersonalExport, type PersonalExport } from "./export.ts";
import {
  type ErasureExport,
  isLastFullAccessHolder,
  refuseIfLastOwner,
} from "./lifecycle.ts";
import { shareAvatar } from "./profile.ts";

type AnyTx = WorkspaceTx<Record<string, never>>;

/** What the erasure reads before it changes anything. */
export interface MemberBeforeErasure {
  readonly userId: string | null;
  readonly name: string;
  readonly title: string | null;
  readonly bio: unknown;
  readonly timezone: string | null;
  readonly avatarBlobId: string | null;
  /** Null when the caller has nobody to hand an export to. */
  readonly personalExport: PersonalExport | null;
}

/**
 * Loads the member to erase, refusing one that is not there.
 *
 * **The export is taken here, before a single row is anonymised, and on the
 * same transaction** (P7-T08b), when the caller asks for it. An export read
 * afterwards would be a copy of what erasure had already destroyed. A
 * person's own deletion asks for none: they were offered their export before
 * they asked, and nobody is there to receive one fourteen days later.
 */
export async function loadMemberForErasure(
  tx: AnyTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly withExport: boolean;
  },
): Promise<MemberBeforeErasure> {
  const [before] = await tx
    .select({
      userId: workspaceMembers.userId,
      name: workspaceMembers.name,
      title: workspaceMembers.title,
      bio: workspaceMembers.bio,
      timezone: workspaceMembers.timezone,
      avatarBlobId: workspaceMembers.avatarBlobId,
    })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.id, input.memberId),
        eq(workspaceMembers.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!before) {
    throw new OperationError("not_found", "No such member.");
  }
  const personalExport = input.withExport
    ? await buildPersonalExport(tx, {
        workspaceId: input.workspaceId,
        memberId: input.memberId,
      })
    : null;
  return { ...before, personalExport };
}

/** What one member's erasure did. */
export interface MemberErasure {
  readonly memberId: string;
  readonly erasedAt: Date;
  readonly removed: ErasureSweep;
  /** The sign-in account behind the member, when there was one. */
  readonly account: AccountErasure | null;
}

/**
 * Anonymises the member, removes what identified them, and erases the
 * account when this was the person's last workspace. Refused for the last
 * full-access holder.
 */
export async function eraseMemberInTx(
  tx: AnyTx,
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly loaded: MemberBeforeErasure;
  },
): Promise<MemberErasure> {
  const { workspaceId, memberId, loaded } = input;
  refuseIfLastOwner(await isLastFullAccessHolder(tx, workspaceId, memberId));

  const erasedAt = new Date();
  // openokr:allow-mutation: the calling Operation's own transaction.
  const [updated] = await tx
    .update(workspaceMembers)
    .set({
      name: "Erased member",
      title: null,
      bio: null,
      bioVersion: null,
      avatarBlobId: null,
      timezone: null,
      quietHours: null,
      userId: null,
      status: "suspended",
      suspendedAt: erasedAt,
      updatedAt: erasedAt,
    })
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .returning({ id: workspaceMembers.id });
  if (!updated) {
    throw new OperationError("not_found", "No such member.");
  }

  // **After the member row, not before** (P7-T08b). Both run in this one
  // transaction, so the order changes nothing about what commits. It changes
  // what a reader of this function believes happened: the row is anonymised
  // and then everything that identified the person outside it is removed,
  // which is the sentence the audit row will carry.
  const removed = await sweepPersonalData(tx, { workspaceId, memberId });

  // Their picture stops being shown to the workspace (completeness review
  // M-22). Clearing the column alone would leave the file readable by
  // everybody through the binding that made it an avatar.
  await shareAvatar(tx, {
    workspaceId,
    previousBlobId: loaded.avatarBlobId,
    next: null,
  });

  // The sign-in account, when this was the person's only workspace
  // (completeness review M-18).
  const account = loaded.userId
    ? await eraseAccountIfAlone(tx, pool, {
        workspaceId,
        userId: loaded.userId,
      })
    : null;

  // Earlier feed entries about this member carried their name in the payload,
  // which is where the feed reads it from. They keep the event and lose the
  // name (completeness review M-18).
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx.execute(sql`
    update activities
       set payload = jsonb_set(payload, '{name}', '"Erased member"'::jsonb)
     where workspace_id = ${workspaceId}
       and subject_type = 'workspace_member'
       and subject_id = ${updated.id}
       and payload ? 'name'
  `);

  return { memberId: updated.id, erasedAt, removed, account };
}

/**
 * The audit payload both callers write: what the sweep removed and what
 * became of the account. Counts only, never an identifier.
 */
export function erasureAuditPayload(
  erasure: MemberErasure,
): Record<string, unknown> {
  return {
    removed: erasure.removed,
    ...(erasure.account
      ? {
          account: {
            anonymised: erasure.account.anonymised,
            otherWorkspaces: erasure.account.otherWorkspaces,
            sessionsRevoked: erasure.account.sessionsRevoked,
            credentialsRemoved: erasure.account.credentialsRemoved,
          },
        }
      : {}),
  };
}

/** The export an administrator's erasure hands back. */
export function erasureExport(
  erasure: MemberErasure,
  loaded: MemberBeforeErasure,
): ErasureExport {
  if (loaded.personalExport === null) {
    throw new Error("An administrator's erasure loads the export first.");
  }
  return {
    memberId: erasure.memberId,
    erasedAt: erasure.erasedAt.toISOString(),
    priorProfile: {
      name: loaded.name,
      title: loaded.title,
      bio: loaded.bio,
      timezone: loaded.timezone,
    },
    removed: erasure.removed,
    data: loaded.personalExport,
  };
}
