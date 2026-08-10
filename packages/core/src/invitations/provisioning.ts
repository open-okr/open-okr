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
import { activeOnly, type WorkspaceTx, workspaceMembers } from "@openokr/db";
import { eq } from "drizzle-orm";
import { bindGroup, ensureMemberGroup } from "../access/contexts.ts";
import { ACCESS_LEVELS, type AccessLevel } from "../access/levels.ts";
import { resolveSubjectContext } from "../access/reads.ts";
import { resolveMemberSettings } from "../settings/registry.ts";

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

  const memberSettings = resolveMemberSettings({});
  // openokr:allow-mutation: this helper is called only from inside an
  // Operation's execute (invitations.acceptLink, invitations
  // .joinByTrustedDomain), on the transaction that Operation opened.
  const [member] = await tx
    .insert(workspaceMembers)
    .values({
      workspaceId: input.workspaceId,
      userId: input.user.id,
      name: input.user.name,
      kind: "human",
      status: "active",
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
  if (context) {
    await bindGroup(tx, {
      workspaceId: input.workspaceId,
      groupId,
      contextId: context.contextId,
      level: input.level ?? ACCESS_LEVELS.edit,
    });
  }

  return { memberId, created: true };
}
