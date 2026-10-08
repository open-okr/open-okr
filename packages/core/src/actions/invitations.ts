/**
 * Invitation actions (TECHNICAL-PLAN §4.1, P2-T04).
 *
 * Creating a link needs `full`, matching the other org-structural actions in
 * `people.ts`. Accepting one is `bootstrap`, the same mechanism
 * `workspace.provision` uses: the person accepting has no member row yet, so
 * there is nothing for the ordinary actor resolution to find. The doc
 * comment on `OperationSpec.bootstrap` in operations/operation.ts is worded
 * around "creates the workspace they run in"; accepting an invite creates
 * the *member*, not the workspace, but needs exactly the same skip — no
 * actor to resolve, full trust handed to the operation's own validation.
 * That comment is widened alongside this file rather than left describing
 * only the first of its two callers.
 */
import {
  activeOnly,
  INVITE_MEMBER_KINDS,
  includeDeleted,
  inviteLinks,
  spaceMembers,
  spaces,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { refuseReason } from "../invitations/preview.ts";
import { provisionMemberForInvite } from "../invitations/provisioning.ts";
import {
  emailDomain,
  generateInviteToken,
  hashInviteToken,
} from "../invitations/tokens.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import {
  addSpaceMemberInTx,
  resolveSpaceContextId,
} from "../spaces/service.ts";
import { requireSeatInTx } from "../tenancy/plans.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/**
 * The context of a space a guest invitation names, when the space is still
 * live (completeness review M-22).
 *
 * Archiving a space leaves its context in place, so the context alone cannot
 * say whether a guest would arrive somewhere that still exists. `refusal` is
 * what the caller says when it does not.
 */
async function liveSpaceContext(
  tx: OperationTx,
  workspaceId: string,
  spaceId: string,
  refusal: string,
): Promise<string> {
  const [space] = await tx
    .select({ id: spaces.id })
    // openokr:allow-raw-read: whether the space an invitation names is live.
    // Issuing needs `full` on the workspace, and accepting is a bootstrap
    // operation whose authorisation is the link itself; no column of the space
    // is returned to either.
    .from(spaces)
    .where(
      activeOnly(
        spaces,
        eq(spaces.id, spaceId),
        eq(spaces.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!space) {
    throw new OperationError("not_found", refusal);
  }
  return resolveSpaceContextId(tx, workspaceId, spaceId);
}

const linkSummary = z.object({
  id: z.uuid(),
  mode: z.enum(["workspace", "personal"]),
  useCount: z.number(),
  maxUses: z.number().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  /**
   * What accepting makes: a member, or a guest of the one space `spaceId`
   * names (completeness review M-22).
   */
  memberKind: z.enum(INVITE_MEMBER_KINDS),
  spaceId: z.uuid().nullable(),
});

/**
 * Every invitation this workspace has issued (P6-G06).
 *
 * P2-T04 built five write actions and no read, so the only way to see what had
 * been issued was to query the table. An administrator cannot revoke a link
 * they cannot see, and `invitations.revokeLink` takes an id, so revoke was
 * unreachable in practice as well as in the interface. The gap audit of
 * 7 September 2026 recorded the whole domain as B-07.
 *
 * **The token is never returned.** It is stored hashed and shown exactly once,
 * at creation, which is what makes a leaked list of invitations harmless. A
 * read that could hand back a working token would undo that, and there is no
 * version of this screen that needs one: an administrator who lost a link
 * revokes it and issues another.
 *
 * Revoked and expired links stay in the list. An administrator asking "did I
 * already invite this person" is asking about history, and a list that hid the
 * answer would send them to issue a second link.
 */
export const listInvitations = defineReadAction({
  name: "invitations.list",
  summary:
    "Every invitation link this workspace has issued, without their tokens.",
  input: z.object({}),
  output: z.array(
    linkSummary.extend({
      email: z.string().nullable(),
      allowedDomains: z.array(z.string()),
      createdAt: z.string(),
    }),
  ),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      // **`full` above is what refuses an ordinary member, and the builder is
      // what enforces it** (P6-G31). This read needs that enforcement more than
      // most: `invite_links` is scoped by tenant and by nothing else, so with
      // nothing checking the declared level any member of the workspace could
      // list every address anybody has ever invited, over REST with an ordinary
      // token.
      //
      // Written by hand here first, at P6-G06a, because at that point the field
      // was recorded and never read. Finding that led to the sweep, so the
      // twenty-five lines that used to sit on this spot now sit in
      // `defineReadAction` and cover all twenty-nine of them.
      const rows = await tx
        .select({
          id: inviteLinks.id,
          mode: inviteLinks.mode,
          email: inviteLinks.email,
          allowedDomains: inviteLinks.allowedDomains,
          useCount: inviteLinks.useCount,
          maxUses: inviteLinks.maxUses,
          expiresAt: inviteLinks.expiresAt,
          revokedAt: inviteLinks.revokedAt,
          memberKind: inviteLinks.memberKind,
          spaceId: inviteLinks.spaceId,
          createdAt: inviteLinks.createdAt,
        })
        .from(inviteLinks)
        .where(
          activeOnly(
            inviteLinks,
            eq(inviteLinks.workspaceId, context.workspaceId),
          ),
        )
        .orderBy(desc(inviteLinks.createdAt));

      return rows.map((row) => ({
        id: row.id,
        mode: row.mode as "workspace" | "personal",
        email: row.email,
        allowedDomains: row.allowedDomains ?? [],
        useCount: row.useCount,
        maxUses: row.maxUses,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
        memberKind: row.memberKind,
        spaceId: row.spaceId,
        createdAt: row.createdAt.toISOString(),
      }));
    });
  },
});

export const createWorkspaceLink = defineWriteAction({
  name: "invitations.createWorkspaceLink",
  summary: "Create a reusable link anyone holding it may join through.",
  input: z.object({
    maxUses: z.number().int().positive().optional(),
    expiresInDays: z.number().int().positive().optional(),
    allowedDomains: z.array(z.string().trim().toLowerCase().min(1)).optional(),
  }),
  output: linkSummary.extend({ token: z.string() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      // **The seat check that must be kind**, because this is the one a
      // person can act on. The funnel checks again when somebody actually
      // joins, and that is the one that must be right; this one exists so
      // the refusal reaches the administrator who caused it rather than the
      // colleague who clicked a link.
      await requireSeatInTx(
        tx,
        workspaceId,
        (used, limit) =>
          `This workspace has ${used} of ${limit} seats in use. Free one, or add seats, before inviting anybody else.`,
      );

      const token = generateInviteToken();
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const [link] = await tx
        .insert(inviteLinks)
        .values({
          workspaceId,
          mode: "workspace",
          tokenHash: hashInviteToken(token),
          allowedDomains: input.allowedDomains ?? null,
          invitedByMemberId: actor.memberId,
          maxUses: input.maxUses ?? null,
          expiresAt,
        })
        .returning({
          id: inviteLinks.id,
          mode: inviteLinks.mode,
          useCount: inviteLinks.useCount,
          maxUses: inviteLinks.maxUses,
          expiresAt: inviteLinks.expiresAt,
          revokedAt: inviteLinks.revokedAt,
          memberKind: inviteLinks.memberKind,
          spaceId: inviteLinks.spaceId,
        });
      const created = link as NonNullable<typeof link>;

      return {
        result: {
          ...created,
          expiresAt: created.expiresAt?.toISOString() ?? null,
          revokedAt: created.revokedAt?.toISOString() ?? null,
          token,
        },
        activity: {
          kind: "invitation.link_created",
          subjectType: "invite_link",
          subjectId: created.id,
        },
        audit: {
          action: "invitations.createWorkspaceLink",
          targetType: "invite_link",
          targetId: created.id,
        },
      };
    },
  }),
});

/**
 * Invites one address, to be used once (P2-T04), as a member or as a guest of
 * one space (completeness review M-22).
 *
 * **A guest could only be made by converting a member**, which meant giving
 * an outsider the whole workspace first and taking it back afterwards. With
 * `guestSpaceId` the invitation makes a guest directly: accepting creates a
 * `guest` member with nothing on the workspace itself, and puts them in that
 * space, where their own group is bound at `view`. The same place
 * `people.convertToGuest` starts from, with the one space the invitation named.
 *
 * **One space, personal only.** A guest is somebody outside the organisation
 * who was asked in by name, and the plans-and-seats design has a guest seeing
 * one space. A reusable guest link would admit whoever it reached, which is
 * the opposite of that.
 */
export const createPersonalLink = defineWriteAction({
  name: "invitations.createPersonalLink",
  summary:
    "Invite one email address, usable once, as a member or as a guest of one space.",
  input: z.object({
    email: z.string().trim().toLowerCase().email(),
    expiresInDays: z.number().int().positive().optional(),
    /**
     * Makes the invitation a guest's, of this space and nothing else. Absent
     * invites a member, as every invitation did before.
     */
    guestSpaceId: z.uuid().optional(),
  }),
  output: linkSummary.extend({ token: z.string() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (input.guestSpaceId) {
        // The space has to exist now, so a mistake is refused to the
        // administrator rather than to the guest who clicks the link.
        await liveSpaceContext(
          tx,
          workspaceId,
          input.guestSpaceId,
          "No such space to invite a guest to.",
        );
      } else {
        // **The seat check that must be kind**, because this is the one a
        // person can act on. The funnel checks again when somebody actually
        // joins, and that is the one that must be right; this one exists so
        // the refusal reaches the administrator who caused it rather than the
        // colleague who clicked a link. A guest is not a seat
        // (plans-and-seats.md), so a guest invitation is never
        // refused for one.
        await requireSeatInTx(
          tx,
          workspaceId,
          (used, limit) =>
            `This workspace has ${used} of ${limit} seats in use. Free one, or add seats, before inviting anybody else.`,
        );
      }

      const token = generateInviteToken();
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const [link] = await tx
        .insert(inviteLinks)
        .values({
          workspaceId,
          mode: "personal",
          tokenHash: hashInviteToken(token),
          email: input.email,
          invitedByMemberId: actor.memberId,
          maxUses: 1,
          expiresAt,
          memberKind: input.guestSpaceId ? "guest" : "human",
          spaceId: input.guestSpaceId ?? null,
        })
        .returning({
          id: inviteLinks.id,
          mode: inviteLinks.mode,
          useCount: inviteLinks.useCount,
          maxUses: inviteLinks.maxUses,
          expiresAt: inviteLinks.expiresAt,
          revokedAt: inviteLinks.revokedAt,
          memberKind: inviteLinks.memberKind,
          spaceId: inviteLinks.spaceId,
        });
      const created = link as NonNullable<typeof link>;

      return {
        result: {
          ...created,
          expiresAt: created.expiresAt?.toISOString() ?? null,
          revokedAt: created.revokedAt?.toISOString() ?? null,
          token,
        },
        activity: {
          kind: "invitation.link_created",
          subjectType: "invite_link",
          subjectId: created.id,
        },
        audit: {
          action: "invitations.createPersonalLink",
          targetType: "invite_link",
          targetId: created.id,
          payload: {
            email: input.email,
            ...(input.guestSpaceId
              ? { guest: true, spaceId: input.guestSpaceId }
              : {}),
          },
        },
        outbox: [
          {
            // The raw token exists only in this transaction's memory: the
            // column stores its hash, one-way. It has to travel through the
            // outbox for the email to be sendable at all, which is a
            // different trade-off than a session token's: single-purpose,
            // expiring, and worth at most one workspace's `edit` level.
            // The relay strips `to` and `token` in the statement that marks
            // the row delivered (OUTBOX_REDACT_ON_DELIVERY), and the daily
            // purge removes the row after `outbox.retentionDays`
            // (completeness review M-19).
            topic: "invitation.email",
            payload: {
              linkId: created.id,
              workspaceId,
              to: input.email,
              token,
            },
            idempotencyKey: `invitation.email:${created.id}`,
          },
        ],
      };
    },
  }),
});

export const revokeLink = defineWriteAction({
  name: "invitations.revokeLink",
  summary: "Revoke a link. Already-used memberships are unaffected.",
  input: z.object({ linkId: z.uuid() }),
  output: z.object({ id: z.uuid(), revokedAt: z.string() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const revokedAt = new Date();
      const [updated] = await tx
        .update(inviteLinks)
        .set({ revokedAt, updatedAt: revokedAt })
        .where(
          activeOnly(
            inviteLinks,
            eq(inviteLinks.id, input.linkId),
            eq(inviteLinks.workspaceId, workspaceId),
          ),
        )
        .returning({ id: inviteLinks.id });
      if (!updated) {
        throw new OperationError("not_found", "No such invite link.");
      }

      return {
        result: { id: updated.id, revokedAt: revokedAt.toISOString() },
        activity: {
          kind: "invitation.link_revoked",
          subjectType: "invite_link",
          subjectId: updated.id,
        },
        audit: {
          action: "invitations.revokeLink",
          targetType: "invite_link",
          targetId: updated.id,
        },
      };
    },
  }),
});

const REFUSAL = "This invitation is no longer valid.";

export const acceptLink = defineWriteAction({
  name: "invitations.acceptLink",
  summary: "Accept an invite link and join the workspace.",
  input: z.object({ token: z.string().min(1) }),
  output: z.object({ memberId: z.uuid() }),
  // Declarative only: `bootstrap: true` below makes `runOperation` treat the
  // caller as `full` unconditionally, since there is no member yet to hold
  // any real level. Declared as `edit` anyway so the registry's own
  // invariant ("a write needs at least edit") stays true by inspection
  // without needing to know which actions are bootstrap operations.
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    bootstrap: true,
    async execute({ tx, workspaceId }) {
      const userId = context.actor.userId;
      if (!userId) {
        throw new OperationError(
          "forbidden",
          "Sign in before accepting an invitation.",
        );
      }

      const [link] = await tx
        .select()
        .from(inviteLinks)
        .where(
          activeOnly(
            inviteLinks,
            eq(inviteLinks.workspaceId, workspaceId),
            eq(inviteLinks.tokenHash, hashInviteToken(input.token)),
          ),
        )
        .limit(1);

      if (!link) {
        throw new OperationError("not_found", REFUSAL);
      }
      // **One reader of these four states, shared with `previewInvite`**
      // (P6-G06b). They were written out here and again in the preview, and
      // two readers of one row is how a page comes to say "you can join this"
      // about something acceptance then refuses. `max_uses` is checked
      // whatever the mode now, which changes nothing: migration 0010 keeps
      // that column as the ceiling on a reusable link and leaves it null on a
      // personal one, whose single use is `member_id` being set.
      if (refuseReason(link, new Date())) {
        throw new OperationError("forbidden", REFUSAL);
      }

      const userResult = await tx.execute<{
        id: string;
        name: string;
        email: string;
      }>(sql`select id, name, email from users where id = ${userId}`);
      const userRow = userResult.rows[0];
      if (!userRow) {
        throw new OperationError("forbidden", "No such account.");
      }

      const domain = emailDomain(userRow.email);
      if (
        link.mode === "personal" &&
        link.email !== userRow.email.toLowerCase()
      ) {
        throw new OperationError(
          "forbidden",
          "This invitation was issued to a different email address.",
        );
      }
      if (
        link.mode === "workspace" &&
        link.allowedDomains &&
        link.allowedDomains.length > 0 &&
        !link.allowedDomains.includes(domain)
      ) {
        throw new OperationError(
          "forbidden",
          "Your email domain is not allowed to use this invitation.",
        );
      }

      // **A guest invitation makes a guest of one space** (completeness review
      // M-22). Resolved before anybody is provisioned, so an invitation to a
      // space archived since it was issued refuses with nothing written.
      const guestSpaceId = link.memberKind === "guest" ? link.spaceId : null;
      const guestSpaceContextId = guestSpaceId
        ? await liveSpaceContext(tx, workspaceId, guestSpaceId, REFUSAL)
        : null;

      // No binding on the workspace for a guest: they reach the space the
      // invitation named and nothing else, which is where
      // `people.convertToGuest` leaves a member too. Somebody who is already a
      // member keeps what they have, because an invitation never demotes.
      const provisioned = await provisionMemberForInvite(tx, {
        workspaceId,
        user: { id: userRow.id, name: userRow.name },
        ...(guestSpaceId
          ? { kind: "guest" as const, bindWorkspace: false }
          : {}),
      });

      if (guestSpaceId && guestSpaceContextId) {
        // Only when they are not in it already. `addSpaceMemberInTx` sets the
        // role it is given, and a manager accepting a guest invitation to
        // their own space must not come out of it a member.
        const [inSpace] = await tx
          .select({ id: spaceMembers.id })
          .from(spaceMembers)
          .where(
            activeOnly(
              spaceMembers,
              eq(spaceMembers.workspaceId, workspaceId),
              eq(spaceMembers.spaceId, guestSpaceId),
              eq(spaceMembers.memberId, provisioned.memberId),
            ),
          )
          .limit(1);
        if (!inSpace) {
          // The member role, which for a guest binds their own group at
          // `view` on the space (`applyRoleBindings`).
          await addSpaceMemberInTx(tx, {
            workspaceId,
            spaceId: guestSpaceId,
            memberId: provisioned.memberId,
            role: "member",
            contextId: guestSpaceContextId,
          });
        }
      }

      await tx
        .update(inviteLinks)
        .set({
          useCount: link.useCount + 1,
          memberId:
            link.mode === "personal" ? provisioned.memberId : link.memberId,
          updatedAt: new Date(),
        })
        .where(activeOnly(inviteLinks, eq(inviteLinks.id, link.id)));

      return {
        result: { memberId: provisioned.memberId },
        activity: {
          kind: "invitation.accepted",
          subjectType: "workspace_member",
          subjectId: provisioned.memberId,
        },
        audit: {
          action: "invitations.acceptLink",
          targetType: "invite_link",
          targetId: link.id,
          payload: {
            memberId: provisioned.memberId,
            alreadyMember: !provisioned.created,
            ...(guestSpaceId ? { guestSpaceId } : {}),
          },
        },
      };
    },
  }),
});

/**
 * Joins the workspace this runs in, because it trusts the domain of the
 * caller's address (P2-T04, completeness review M-34).
 *
 * Nothing called this until M-34: which workspaces trust a domain was a
 * question nobody without a membership could ask. `trustedDomainOffers` asks it
 * now, and the join page and the front door offer what it finds. This is the
 * write behind the button, and it checks everything again rather than trusting
 * the page, because a request can name any workspace it likes.
 *
 * **A confirmed address, or nothing.** Anybody can type somebody else's
 * company address into a sign-up form, so an unconfirmed one would let a
 * stranger claim a whole domain.
 *
 * **A member somebody suspended or removed stays out.** The funnel hands back
 * a live membership unchanged and inserts a new one when the old row is
 * deleted, so without the check below a removed member could walk straight
 * back in. Only an administrator's invitation brings them back.
 */
export const joinByTrustedDomain = defineWriteAction({
  name: "invitations.joinByTrustedDomain",
  summary:
    "Join a workspace because it trusts the domain of your confirmed email address.",
  input: z.object({}),
  output: z.object({ memberId: z.uuid() }),
  // Declarative only: see acceptLink above, same bootstrap reasoning.
  access: ACCESS_LEVELS.edit,
  operation: (context, _input) => ({
    bootstrap: true,
    async execute({ tx, workspaceId }) {
      const userId = context.actor.userId;
      if (!userId) {
        throw new OperationError("forbidden", "Sign in first.");
      }

      const userResult = await tx.execute<{
        id: string;
        name: string;
        email: string;
        email_verified: boolean;
      }>(
        sql`select id, name, email, email_verified from users where id = ${userId}`,
      );
      const userRow = userResult.rows[0];
      if (!userRow) {
        throw new OperationError("forbidden", "No such account.");
      }
      if (!userRow.email_verified) {
        throw new OperationError(
          "forbidden",
          "Confirm your email address before joining a workspace by its domain.",
        );
      }

      // openokr:allow-raw-read: no member row exists yet for this user in
      // this workspace (this is a bootstrap operation), so getAccessScoped
      // cannot be used to reach the workspace's settings; the trusted-domain
      // list itself is the authorisation this action grants access through.
      const workspaceResult = await tx.execute<{
        settings: { trustedEmailDomains?: readonly string[] };
      }>(sql`select settings from workspaces where id = ${workspaceId}`);
      const trusted =
        workspaceResult.rows[0]?.settings.trustedEmailDomains ?? [];
      const domain = emailDomain(userRow.email);
      if (!trusted.includes(domain)) {
        throw new OperationError(
          "forbidden",
          "Your email domain is not trusted by this workspace.",
        );
      }

      const [previous] = await tx
        .select({
          status: workspaceMembers.status,
          deletedAt: workspaceMembers.deletedAt,
        })
        .from(workspaceMembers)
        .where(
          // Deleted rows included on purpose: a removed member is exactly the
          // row this has to see.
          includeDeleted(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userRow.id),
          ),
        )
        .orderBy(sql`${workspaceMembers.deletedAt} is null desc`)
        .limit(1);
      if (
        previous &&
        (previous.deletedAt !== null || previous.status === "suspended")
      ) {
        throw new OperationError(
          "forbidden",
          "Your membership of this workspace was suspended or removed, so your domain cannot bring it back. Ask an administrator.",
        );
      }

      const provisioned = await provisionMemberForInvite(tx, {
        workspaceId,
        user: { id: userRow.id, name: userRow.name },
      });

      return {
        result: { memberId: provisioned.memberId },
        activity: {
          kind: "invitation.joined_by_trusted_domain",
          subjectType: "workspace_member",
          subjectId: provisioned.memberId,
        },
        audit: {
          action: "invitations.joinByTrustedDomain",
          targetType: "workspace_member",
          targetId: provisioned.memberId,
          payload: { domain, alreadyMember: !provisioned.created },
        },
      };
    },
  }),
});
