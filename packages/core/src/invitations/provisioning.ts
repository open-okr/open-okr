/**
 * The one member-provisioning funnel every joining path lands in
 * (TECHNICAL-PLAN §4.1, P2-T04). A reusable workspace link, a single-use
 * personal link and trusted-domain joining all call this; none of them
 * inserts into `workspace_members` on its own.
 *
 * Idempotent: a user who already has a live membership in this workspace
 * gets that membership back rather than a second row. Accepting the same
 * invite twice, or one invite after another already worked, both land here.
 */
import {
  accessBindings,
  activeOnly,
  type BuiltinRoleKey,
  users,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { bindGroup, ensureMemberGroup } from "../access/contexts.ts";
import { ACCESS_LEVELS, type AccessLevel } from "../access/levels.ts";
import { resolveSubjectContext } from "../access/reads.ts";
import { builtinRoleId, defaultRoleId } from "../access/roles.ts";
import { resolveMemberSettings } from "../settings/registry.ts";
import { requireSeatInTx } from "../tenancy/plans.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export interface ProvisionMemberInput {
  readonly workspaceId: string;
  readonly user: { readonly id: string; readonly name: string };
  /**
   * No invite carries its own level today — TECHNICAL-PLAN's `invite_links`
   * row has no such column — so every joining path defaults to the same
   * level `defineWriteAction` itself defaults to. Recorded in STATUS.md as a
   * simplification a human may want to revisit once invites need to grant
   * something other than edit.
   */
  readonly level?: AccessLevel;
  /**
   * What kind of member this is. Defaults to `human`, which every joining
   * path wants.
   *
   * `guest` is the cloud support session (P8-T04a), and widening this by one
   * parameter is deliberately cheaper than a second insert path: a support
   * session that wrote its own member row would be a second place that
   * decides what a member is, and the whole point of this funnel is that
   * there is one.
   */
  readonly kind?: "human" | "guest";
  /**
   * Whether the new member's own group is bound on the workspace's context.
   *
   * True for every joining path but one. A guest invited to a space reaches
   * that space and nothing on the workspace itself (completeness review M-22),
   * which is the state `people.convertToGuest` leaves behind: no binding on
   * the member's own group, and the group kept so the space's binding has
   * somewhere to attach. A support session is a guest too and keeps its
   * workspace binding, because the level the owner chose is on the workspace.
   */
  readonly bindWorkspace?: boolean;
  /**
   * A built-in role for a guest, which otherwise holds none.
   *
   * The support session only (UAT BUG-021). Its binding is on the workspace
   * context, and goals and spaces have contexts of their own, so a support
   * operator with no role saw an empty workspace. The role gives them what a
   * member sees, at no more than the level the customer granted.
   */
  readonly guestRole?: BuiltinRoleKey;
}

export interface ProvisionedMember {
  readonly memberId: string;
  readonly created: boolean;
}

export async function provisionMemberForInvite<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: ProvisionMemberInput): Promise<ProvisionedMember> {
  const [existing] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(workspaceMembers.userId, input.user.id),
      ),
    )
    .limit(1);
  if (existing) {
    return { memberId: existing.id, created: false };
  }

  // **A member waiting for this person is claimed, not doubled** (completeness
  // review H-18). An archive import and the FlowyTeam importer both write a
  // member with no account behind it and the person's address in
  // `placeholder_email`, and nothing ever connected that row to the person
  // when they arrived: they got a second, empty membership, and every goal,
  // check-in and comment stayed with the first.
  const claimed = await claimWaitingMember(tx, input);
  if (claimed) {
    return { memberId: claimed, created: false };
  }

  // **The seat check that must be right**, because this is the one place a
  // member row is inserted. Checking only at the invitation would let one
  // reusable link overflow a plan by any amount: the link admits everybody
  // who holds it, and nobody checks again.
  //
  // Above the insert and inside the caller's transaction, so the count and
  // the insert cannot disagree under concurrency. A guest is not a seat, so a
  // support session is never refused for one.
  if ((input.kind ?? "human") === "human") {
    await requireSeatInTx(
      tx,
      input.workspaceId,
      (used, limit) =>
        `This workspace is full: ${used} of ${limit} seats are in use. Ask an administrator to free one or add seats.`,
    );
  }

  const memberSettings = resolveMemberSettings({});
  // The workspace's default role, for a human only (P8-G13a). A guest holds
  // no role on purpose: they were asked into one space, and a workspace-wide
  // role would hand them the whole workspace instead.
  const roleId =
    (input.kind ?? "human") === "human"
      ? await defaultRoleId(tx, input.workspaceId)
      : input.guestRole
        ? await builtinRoleId(tx, input.workspaceId, input.guestRole)
        : null;
  // openokr:allow-mutation: this helper is called only from inside an
  // Operation's execute (invitations.acceptLink, invitations
  // .joinByTrustedDomain), on the transaction that Operation opened.
  const [member] = await tx
    .insert(workspaceMembers)
    .values({
      workspaceId: input.workspaceId,
      userId: input.user.id,
      name: input.user.name,
      kind: input.kind ?? "human",
      status: "active",
      ...(roleId ? { roleId } : {}),
      primaryChannel:
        memberSettings.primaryChannel as typeof workspaceMembers.$inferInsert.primaryChannel,
      quietHours: memberSettings.quietHours,
    })
    .returning({ id: workspaceMembers.id });
  const memberId = (member as { id: string }).id;

  const groupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId,
  });
  const context = await resolveSubjectContext(
    tx,
    "workspace",
    input.workspaceId,
    input.workspaceId,
  );
  if (context && input.bindWorkspace !== false) {
    await bindGroup(tx, {
      workspaceId: input.workspaceId,
      groupId,
      contextId: context.contextId,
      level: input.level ?? ACCESS_LEVELS.edit,
    });
  }

  return { memberId, created: true };
}

/**
 * The unclaimed member carrying this person's address, taken over by them.
 *
 * Unclaimed means no account behind it, and it is matched on the address the
 * person signed up with, ignoring case, which is the one fact an import and a
 * sign-up can agree on. A suspended row stays suspended: somebody decided
 * that, and joining does not undo it. A placeholder was never a seat, so
 * claiming one is checked like a new member.
 */
async function claimWaitingMember<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: ProvisionMemberInput): Promise<string | null> {
  if ((input.kind ?? "human") !== "human") {
    return null;
  }
  const [user] = await tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, input.user.id))
    .limit(1);
  if (!user?.email) {
    return null;
  }
  const [waiting] = await tx
    .select({ id: workspaceMembers.id, kind: workspaceMembers.kind })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, input.workspaceId),
        isNull(workspaceMembers.userId),
        ne(workspaceMembers.status, "suspended"),
        inArray(workspaceMembers.kind, ["human", "placeholder"]),
        sql`lower(${workspaceMembers.placeholderEmail}) = lower(${user.email})`,
      ),
    )
    .limit(1);
  if (!waiting) {
    return null;
  }
  if (waiting.kind === "placeholder") {
    await requireSeatInTx(
      tx,
      input.workspaceId,
      (used, limit) =>
        `This workspace is full: ${used} of ${limit} seats are in use. Ask an administrator to free one or add seats.`,
    );
  }
  // openokr:allow-mutation: the caller's Operation transaction, like the
  // insert this replaces.
  await tx
    .update(workspaceMembers)
    .set({
      userId: input.user.id,
      kind: "human",
      status: "active",
      placeholderEmail: null,
      updatedAt: new Date(),
    })
    .where(activeOnly(workspaceMembers, eq(workspaceMembers.id, waiting.id)));

  // Whatever access the import carried stands. A member that arrived with
  // none gets what a joiner gets, through the same binding.
  const context = await resolveSubjectContext(
    tx,
    "workspace",
    input.workspaceId,
    input.workspaceId,
  );
  if (context) {
    const groupId = await ensureMemberGroup(tx, {
      workspaceId: input.workspaceId,
      memberId: waiting.id,
    });
    const [bound] = await tx
      .select({ id: accessBindings.id })
      .from(accessBindings)
      .where(
        activeOnly(
          accessBindings,
          eq(accessBindings.groupId, groupId),
          eq(accessBindings.contextId, context.contextId),
          isNull(accessBindings.tag),
        ),
      )
      .limit(1);
    if (!bound) {
      await bindGroup(tx, {
        workspaceId: input.workspaceId,
        groupId,
        contextId: context.contextId,
        level: input.level ?? ACCESS_LEVELS.edit,
      });
    }
  }
  return waiting.id;
}
