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
  inviteLinks,
  type WorkspaceTx,
  withWorkspace,
} from "@openokr/db";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  resolveMemberAccessLevel,
  resolveSubjectContext,
} from "../access/reads.ts";
import { provisionMemberForInvite } from "../invitations/provisioning.ts";
import {
  emailDomain,
  generateInviteToken,
  hashInviteToken,
} from "../invitations/tokens.ts";
import { OperationError } from "../operations/operation.ts";
import { actingMemberId } from "./api-tokens.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const linkSummary = z.object({
  id: z.uuid(),
  mode: z.enum(["workspace", "personal"]),
  useCount: z.number(),
  maxUses: z.number().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
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
      // **The level is enforced here, not by the `access` field above.**
      // `defineReadAction` records `access` and nothing checks it: not the
      // builder, not `callAction`, not the REST or agent transports. For a read
      // whose rows are already access-scoped that is fine, because the getter
      // does the work. This read is not one of those: `invite_links` is scoped
      // by tenant and by nothing else, so without this any member of the
      // workspace could list every address anybody has ever invited, over REST
      // with an ordinary token. Found at P6-G06a; the general sweep is P6-G31.
      //
      // `forbidden` rather than the getter's usual `not_found`: the caller is
      // already a member of this workspace and knows it exists, so there is no
      // existence oracle to protect here, and the write actions beside this one
      // refuse the same way.
      const memberId = await actingMemberId(
        tx as WorkspaceTx,
        context.workspaceId,
        context.actor.userId,
      );
      const workspaceContext = await resolveSubjectContext(
        tx,
        "workspace",
        context.workspaceId,
        context.workspaceId,
      );
      const level = workspaceContext
        ? await resolveMemberAccessLevel(tx, {
            workspaceId: context.workspaceId,
            memberId,
            contextId: workspaceContext.contextId,
          })
        : 0;
      if (level < ACCESS_LEVELS.full) {
        throw new OperationError(
          "forbidden",
          "Only a workspace administrator can read the invitations.",
        );
      }

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

export const createPersonalLink = defineWriteAction({
  name: "invitations.createPersonalLink",
  summary: "Invite one email address, usable once.",
  input: z.object({
    email: z.string().trim().toLowerCase().email(),
    expiresInDays: z.number().int().positive().optional(),
  }),
  output: linkSummary.extend({ token: z.string() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
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
        })
        .returning({
          id: inviteLinks.id,
          mode: inviteLinks.mode,
          useCount: inviteLinks.useCount,
          maxUses: inviteLinks.maxUses,
          expiresAt: inviteLinks.expiresAt,
          revokedAt: inviteLinks.revokedAt,
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
          payload: { email: input.email },
        },
        outbox: [
          {
            // The raw token exists only in this transaction's memory: the
            // column stores its hash, one-way. It has to travel through the
            // outbox for the email to be sendable at all, which is a
            // different trade-off than a session token's: single-purpose,
            // expiring, and worth at most one workspace's `edit` level.
            // Outbox rows are not deleted after delivery today (0001_outbox
            // .sql has no such job), so this payload remains readable in the
            // table after the invite is used or expires — worth a look at
            // P7-T03.
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
      if (link.revokedAt) {
        throw new OperationError("forbidden", REFUSAL);
      }
      if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
        throw new OperationError("forbidden", REFUSAL);
      }
      if (link.mode === "personal" && link.memberId) {
        throw new OperationError("forbidden", REFUSAL);
      }
      if (
        link.mode === "workspace" &&
        link.maxUses !== null &&
        link.useCount >= link.maxUses
      ) {
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

      const provisioned = await provisionMemberForInvite(tx, {
        workspaceId,
        user: { id: userRow.id, name: userRow.name },
      });

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
          },
        },
      };
    },
  }),
});

export const joinByTrustedDomain = defineWriteAction({
  name: "invitations.joinByTrustedDomain",
  summary:
    "Join a workspace automatically because your email domain is trusted.",
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
      }>(sql`select id, name, email from users where id = ${userId}`);
      const userRow = userResult.rows[0];
      if (!userRow) {
        throw new OperationError("forbidden", "No such account.");
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
          payload: { domain },
        },
      };
    },
  }),
});
