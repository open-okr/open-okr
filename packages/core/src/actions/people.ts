/**
 * People actions (TECHNICAL-PLAN §4.1, screen S-33, P2-T03).
 *
 * **Self versus others.** `updateOwnProfile` is the member's own name,
 * timezone, avatar, bio and the rest of what is nobody else's business.
 * `updateMember` is somebody else's name, title and manager, editable only by
 * someone holding `full` on the workspace's own context. Title and manager
 * stay the administrator's; the name is both (plan 0.8.0 Q2).
 *
 * **Who writes which name** (docs/design/account-self-service.md D22 to D25,
 * plan 0.8.0 Y5). A person has two: `users.name` belongs to the account and
 * is what a new workspace's member row starts from, and
 * `workspace_members.name` is what each workspace shows. The member's own
 * change writes this workspace's row and `users.name` together, so the next
 * workspace starts from their latest choice; other workspaces keep the name
 * they have, because their administrators may have set it. An
 * administrator's change writes this workspace's row only. Nothing else
 * writes `users.name` after the account is made: Better Auth's
 * `/update-user` is off (Y6), and a directory never writes a name, so a
 * member a directory manages may still rename themselves (AS-Q1). A
 * demonstration account may not, because anybody can sign in to it.
 *
 * **Suspend, restore, convert, erase** all require `full` and, except
 * restore, all refuse to act on the workspace's last full-access holder
 * (`isLastFullAccessHolder` in `../people/lifecycle.ts`).
 */

import {
  accessBindings,
  activeOnly,
  BUILTIN_ROLE_KEYS,
  softDeleteRows,
  users,
  withContext,
  withWorkspace,
  workspaceMembers,
  workspaceRoles,
} from "@openokr/db";
import { EMAIL_PATTERN, isListedTimezone } from "@openokr/formats";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { bindGroup, ensureMemberGroup } from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  resolveMemberAccessLevel,
  resolveSubjectContext,
} from "../access/reads.ts";
import { moveAdministratorRole } from "../access/roles.ts";
import { isDemoAccount } from "../demo/persona-list.ts";
import { findLegacyRowInTx, legacyKey } from "../imports/legacy.ts";
import { OperationError } from "../operations/operation.ts";
import {
  eraseMemberInTx,
  erasureAuditPayload,
  erasureExport,
  loadMemberForErasure,
} from "../people/erase-member.ts";
import { buildPersonalExport } from "../people/export.ts";
import {
  isLastFullAccessHolder,
  refuseIfLastOwner,
  stripBindings,
} from "../people/lifecycle.ts";
import {
  buildOrgChart,
  possibleManagers,
  wouldCreateManagerCycle,
} from "../people/manager-chain.ts";
import {
  isBlankDocument,
  requireAvatarImage,
  shareAvatar,
} from "../people/profile.ts";
import {
  filesFinished,
  markedAsRichText,
  UPLOADING_MESSAGE,
} from "../rich-text/field-schema.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";
import { resolveMemberSettings } from "../settings/registry.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";
import { wallClock } from "./wall-clock.ts";

/** `null` clears the bio; anything else must be a valid rich text
 * document (docs/design/rich-text-editor.md). Validated at the input
 * boundary, same as the timezone below, rather than inside
 * `execute()` — a bad document is refused before the transaction opens. */
const bioInputSchema = markedAsRichText(
  z
    .unknown()
    .nullable()
    .refine(
      (value) =>
        value === null || isValidRichText(value, RICH_TEXT_SCHEMA_VERSION),
      {
        message: "bio must be a valid rich text document.",
      },
    )
    // Plan 0.7.0 R1, as on every other rich text field.
    .refine((value) => value === null || filesFinished(value), {
      message: UPLOADING_MESSAGE,
    }),
).optional();

/**
 * A member's name, as both the member's own form and an administrator's take
 * it (docs/design/account-self-service.md D22, §5).
 */
const memberName = z
  .string()
  .trim()
  .min(1, "A member needs a name.")
  .max(200, "Use at most 200 characters.");

/** Said to a demonstration account that tries to rename itself (D1). */
const DEMO_KEEPS_NAME =
  "Demonstration accounts keep their name. Anyone can sign in to them, so anyone could change it.";

const memberSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  title: z.string().nullable(),
  kind: z.enum(["human", "guest", "agent", "placeholder"]),
  status: z.enum(["active", "invited", "suspended"]),
  managerId: z.uuid().nullable(),
  timezone: z.string().nullable(),
  /**
   * The workspace role this member holds, or null (P8-G13b).
   *
   * Null is a real answer and the common one for a guest, an agent and a
   * placeholder: a role is workspace-wide, and somebody invited into one
   * space must not be handed the workspace by it. The roles screen reads this
   * to say who holds what without a second query per person.
   */
  roleId: z.uuid().nullable(),
});

export const updateOwnProfile = defineWriteAction({
  name: "people.updateOwnProfile",
  summary:
    "Update the signed-in member's own name, timezone, avatar, bio, primary channel or quiet hours.",
  input: z.object({
    /**
     * Their own name (plan 0.8.0 Y5). Written to this workspace's member row
     * and to the account's name, never to another workspace's row.
     */
    name: memberName.optional(),
    // On the list the profile offers, trimmed first (docs/design/
    // guided-inputs.md §4.6). A name the runtime merely resolves, such as
    // `EST`, was stored as typed.
    timezone: z
      .string()
      .trim()
      .refine(isListedTimezone, { message: "Unknown timezone." })
      .optional(),
    avatarBlobId: z.uuid().nullable().optional(),
    bio: bioInputSchema,
    /**
     * Where messages go (P5-T02c). `app` is in-app only.
     *
     * Here rather than in a channel action of its own, because it is one of a
     * member's own profile facts and a second action for it would mean two
     * places that can change where the product reaches somebody.
     */
    primaryChannel: z
      .enum(["app", "email", "slack", "teams", "whatsapp", "telegram"])
      .optional(),
    /**
     * How the product looks to this member (P6-G23).
     *
     * Here rather than in a control of its own, for the same reason the
     * primary channel is: both are the member's own profile facts, and a
     * second action would be a second place that can change them. Null is
     * "follow the system", which is what the theme provider does with no
     * stored value, and not an unanswered question.
     */
    theme: z.enum(["light", "dark", "system"]).nullable().optional(),
    density: z.enum(["comfortable", "compact"]).nullable().optional(),
    /**
     * Which catalogue renders for this member (P6-G22a).
     *
     * Null is "follow the workspace", not an unanswered question. A closed
     * set, because a locale with no catalogue would make `translate()` raise
     * on the first key it met.
     */
    language: z.enum(["en", "ms"]).nullable().optional(),
    /**
     * When not to be messaged, in the member's own timezone.
     *
     * Null clears it. AI-NATIVE-PLAN §5.4 defers a nudge inside this window to
     * the next open one rather than dropping it, so setting a window loses
     * nothing.
     */
    quietHours: z
      .object({ start: wallClock, end: wallClock })
      .nullable()
      .optional(),
  }),
  output: memberSummary,
  // A write, so at least edit (the registry's own invariant: "a write that
  // only asked for view would be a silent escalation"). Every active member
  // now holds edit on the workspace's own context through workspace_standard
  // (packages/core/src/workspaces/provisioning.ts), which is what makes this
  // reachable by an ordinary member and not just the founding admin.
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    /**
     * The avatar, checked before anything is written (completeness review
     * M-22).
     *
     * `avatarBlobId` was taken on trust: any id at all, including a file the
     * member had never been able to open, and the avatar is shown to the whole
     * workspace. So the file must be one this member can read through the
     * access getter, and an image that has been through `storeUpload`.
     */
    async load({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("forbidden", "No member to update.");
      }
      const [current] = await tx
        .select({
          avatarBlobId: workspaceMembers.avatarBlobId,
          userId: workspaceMembers.userId,
        })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, actor.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!current) {
        throw new OperationError("not_found", "No such member.");
      }
      // A demonstration account keeps its name (account-self-service.md D1):
      // anybody can sign in to it, so one visitor's rename is every
      // visitor's until the nightly rebuild.
      if (input.name !== undefined && current.userId) {
        const [account] = await tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, current.userId))
          .limit(1);
        if (isDemoAccount(account?.email)) {
          throw new OperationError("forbidden", DEMO_KEEPS_NAME);
        }
      }
      if (!input.avatarBlobId) {
        return {
          previousAvatarBlobId: current.avatarBlobId,
          userId: current.userId,
          avatar: null,
        };
      }
      return {
        previousAvatarBlobId: current.avatarBlobId,
        userId: current.userId,
        avatar: await requireAvatarImage(tx, {
          workspaceId,
          memberId: actor.memberId,
          blobId: input.avatarBlobId,
        }),
      };
    },
    async execute({ tx, workspaceId, actor, loaded }) {
      if (!actor.memberId) {
        throw new OperationError("forbidden", "No member to update.");
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      // Which facts changed, by name and never by value, for the audit row:
      // a bio is somebody's own words and does not belong in the trail.
      const changed: string[] = [];
      if (input.name !== undefined) {
        patch.name = input.name;
        changed.push("name");
      }
      if (input.timezone !== undefined) {
        patch.timezone = input.timezone;
        changed.push("timezone");
      }
      if (input.avatarBlobId !== undefined) {
        patch.avatarBlobId = input.avatarBlobId;
        changed.push("avatar");
        await shareAvatar(tx, {
          workspaceId,
          previousBlobId: loaded.previousAvatarBlobId,
          next: loaded.avatar,
        });
      }
      if (input.bio !== undefined) {
        // An emptied editor clears the bio rather than storing a document with
        // nothing in it, so "no bio" has one shape whichever surface wrote it.
        patch.bio =
          input.bio === null || isBlankDocument(input.bio) ? null : input.bio;
        patch.bioVersion = sql`coalesce(${workspaceMembers.bioVersion}, 0) + 1`;
        changed.push("bio");
      }
      if (input.primaryChannel !== undefined) {
        patch.primaryChannel = input.primaryChannel;
        changed.push("primaryChannel");
      }
      if (input.theme !== undefined) {
        patch.theme = input.theme;
        changed.push("theme");
      }
      if (input.density !== undefined) {
        patch.density = input.density;
        changed.push("density");
      }
      if (input.language !== undefined) {
        patch.language = input.language;
        changed.push("language");
      }
      if (input.quietHours !== undefined) {
        patch.quietHours = input.quietHours;
        changed.push("quietHours");
      }

      const [updated] = await tx
        .update(workspaceMembers)
        .set(patch)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, actor.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .returning({
          id: workspaceMembers.id,
          name: workspaceMembers.name,
          title: workspaceMembers.title,
          kind: workspaceMembers.kind,
          status: workspaceMembers.status,
          managerId: workspaceMembers.managerId,
          timezone: workspaceMembers.timezone,
          roleId: workspaceMembers.roleId,
        });
      if (!updated) {
        throw new OperationError("not_found", "No such member.");
      }
      // **The account's name follows the member's own choice** (D22), in
      // this transaction, so the two never disagree about what the person
      // last chose. Other workspaces' rows are left as they are.
      if (input.name !== undefined && loaded.userId) {
        // openokr:allow-mutation: this Operation's own transaction. The
        // account is identity data outside any workspace, and this is the
        // one write after sign-up that may change its name, as erasure's is
        // the one that may anonymise it.
        await tx
          .update(users)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(users.id, loaded.userId));
      }

      return {
        result: updated,
        activity: {
          kind: "member.profile_updated",
          subjectType: "workspace_member",
          subjectId: updated.id,
          // The name at the moment of the edit, not just the id: a feed
          // entry has to read "Jane Doe updated their profile" without a
          // second query, and it has to keep reading that after Jane
          // renames herself or is later erased.
          payload: { name: updated.name },
        },
        audit: {
          action: "people.updateOwnProfile",
          targetType: "workspace_member",
          targetId: updated.id,
          payload: { changed },
        },
      };
    },
  }),
});

export const updateMember = defineWriteAction({
  name: "people.updateMember",
  summary: "Update another member's name, title or manager (org fields).",
  input: z.object({
    memberId: z.uuid(),
    // This workspace's row only, never the account's name (account-self-
    // service.md D24): one workspace's administrator does not decide what the
    // next workspace sees.
    name: memberName.optional(),
    title: z.string().trim().max(200).nullable().optional(),
    managerId: z.uuid().nullable().optional(),
  }),
  output: memberSummary,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      if (input.managerId) {
        const cycle = await wouldCreateManagerCycle(tx, {
          workspaceId,
          memberId: input.memberId,
          proposedManagerId: input.managerId,
        });
        if (cycle) {
          throw new OperationError(
            "forbidden",
            "That would make a manager chain that loops back on itself.",
          );
        }
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) {
        patch.name = input.name;
      }
      if (input.title !== undefined) {
        patch.title = input.title;
      }
      if (input.managerId !== undefined) {
        patch.managerId = input.managerId;
      }

      const [updated] = await tx
        .update(workspaceMembers)
        .set(patch)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .returning({
          id: workspaceMembers.id,
          name: workspaceMembers.name,
          title: workspaceMembers.title,
          kind: workspaceMembers.kind,
          status: workspaceMembers.status,
          managerId: workspaceMembers.managerId,
          timezone: workspaceMembers.timezone,
          roleId: workspaceMembers.roleId,
        });
      if (!updated) {
        throw new OperationError("not_found", "No such member.");
      }

      return {
        result: updated,
        activity: {
          kind: "member.updated",
          subjectType: "workspace_member",
          subjectId: updated.id,
          payload: { name: updated.name },
        },
        audit: {
          action: "people.updateMember",
          targetType: "workspace_member",
          targetId: updated.id,
        },
      };
    },
  }),
});

const statusChangeOutput = z.object({
  id: z.uuid(),
  status: z.enum(["active", "invited", "suspended"]),
});

export const suspendMember = defineWriteAction({
  name: "people.suspend",
  summary: "Suspend a member, removing every access they had.",
  input: z.object({ memberId: z.uuid() }),
  output: statusChangeOutput,
  access: ACCESS_LEVELS.full,
  // Destructive scope (docs/design/irreversible-scope.md, plan 0.7.0 O6,
  // approved 9 November 2026): it shuts a person out of the workspace.
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      refuseIfLastOwner(
        await isLastFullAccessHolder(tx, workspaceId, input.memberId),
      );

      const [updated] = await tx
        .update(workspaceMembers)
        .set({
          status: "suspended",
          suspendedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .returning({
          id: workspaceMembers.id,
          status: workspaceMembers.status,
          name: workspaceMembers.name,
        });
      if (!updated) {
        throw new OperationError("not_found", "No such member.");
      }

      return {
        result: { id: updated.id, status: updated.status },
        activity: {
          kind: "member.suspended",
          subjectType: "workspace_member",
          subjectId: updated.id,
          payload: { name: updated.name },
        },
        audit: {
          action: "people.suspend",
          targetType: "workspace_member",
          targetId: updated.id,
        },
      };
    },
  }),
});

/**
 * Makes a member an administrator, or returns one to the standard level
 * (completeness review H-14).
 *
 * Nothing could: provisioning gives the founder `full`, invitations grant
 * `edit` at most, and the profile page told a sole administrator to hand over
 * first with no way to do it. So a workspace whose founder left had no
 * administrator, for good.
 *
 * **Full, or the standard level, and nothing between.** Every human member
 * already holds `edit` through the workspace's standard group, and a level is
 * the highest binding, so a personal binding can only raise it. This grants
 * or removes the one that raises it to `full`.
 *
 * People only. An agent never holds workspace-wide access (CLAUDE.md: least
 * privilege, no ambient authority), a guest is outside the organisation by
 * definition, and a placeholder has nobody behind it. Stepping down is
 * refused to the last administrator, by the same rule suspension uses.
 */
export const setAdministrator = defineWriteAction({
  name: "people.setAdministrator",
  summary:
    "Makes a member an administrator with full access to the workspace, or returns them to the standard level.",
  input: z.object({ memberId: z.uuid(), administrator: z.boolean() }),
  output: z.object({ id: z.uuid(), administrator: z.boolean() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [member] = await tx
        .select({
          id: workspaceMembers.id,
          name: workspaceMembers.name,
          kind: workspaceMembers.kind,
          status: workspaceMembers.status,
        })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!member) {
        throw new OperationError("not_found", "No such member.");
      }
      if (input.administrator && member.kind !== "human") {
        throw new OperationError(
          "forbidden",
          member.kind === "agent"
            ? "An agent never holds workspace-wide access. Bind it to named spaces and goals instead."
            : member.kind === "guest"
              ? "A guest cannot administer the workspace. Convert them to a member first."
              : "Nobody has claimed this member yet, so there is nobody to make an administrator.",
        );
      }
      if (input.administrator && member.status !== "active") {
        throw new OperationError(
          "forbidden",
          "Only an active member can be made an administrator.",
        );
      }

      const context = await resolveSubjectContext(
        tx,
        "workspace",
        workspaceId,
        workspaceId,
      );
      if (!context) {
        throw new OperationError("not_found", "No such workspace.");
      }
      const groupId = await ensureMemberGroup(tx, {
        workspaceId,
        memberId: member.id,
      });
      const level = await resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: member.id,
        contextId: context.contextId,
      });

      if (!input.administrator) {
        refuseIfLastOwner(
          await isLastFullAccessHolder(tx, workspaceId, member.id),
        );
      }
      const wanted = input.administrator
        ? ACCESS_LEVELS.full
        : ACCESS_LEVELS.edit;
      const alreadyThere = input.administrator
        ? level >= ACCESS_LEVELS.full
        : level < ACCESS_LEVELS.full;
      if (!alreadyThere) {
        // A group holds one live untagged binding per context, so the old one
        // is retired and the new one written: the level changes at once and
        // the history of who held what survives, as `unbindGroup` keeps it.
        await softDeleteRows(
          tx,
          accessBindings,
          and(
            eq(accessBindings.workspaceId, workspaceId),
            eq(accessBindings.groupId, groupId),
            eq(accessBindings.contextId, context.contextId),
            isNull(accessBindings.tag),
          ) as SQL,
        );
        await bindGroup(tx, {
          workspaceId,
          groupId,
          contextId: context.contextId,
          level: wanted,
        });
      }

      // **The role moves with the binding** (P8-G13a). A level is the maximum
      // over the bindings reaching somebody and the level their role grants,
      // so lowering the binding alone would leave a founder holding Owner at
      // full access after stepping down, and this action would have done
      // nothing. Administration is now said in two places and both have to
      // agree.
      //
      // Stepping down returns them to the workspace default rather than to no
      // role at all: "the standard level every member holds" is what the
      // default role is for, and a member with no role is a guest.
      await moveAdministratorRole(tx, {
        workspaceId,
        memberId: member.id,
        administrator: input.administrator,
      });

      return {
        result: { id: member.id, administrator: input.administrator },
        activity: {
          kind: "member.administrator_set",
          subjectType: "workspace_member",
          subjectId: member.id,
          payload: { name: member.name, administrator: input.administrator },
        },
        audit: {
          action: "people.setAdministrator",
          targetType: "workspace_member",
          targetId: member.id,
          payload: { administrator: input.administrator },
        },
      };
    },
  }),
});

export const restoreMember = defineWriteAction({
  name: "people.restore",
  summary: "Restore a suspended member's access.",
  input: z.object({ memberId: z.uuid() }),
  output: statusChangeOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [updated] = await tx
        .update(workspaceMembers)
        .set({ status: "active", suspendedAt: null, updatedAt: new Date() })
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.status, "suspended"),
          ),
        )
        .returning({
          id: workspaceMembers.id,
          status: workspaceMembers.status,
          name: workspaceMembers.name,
        });
      if (!updated) {
        throw new OperationError(
          "not_found",
          "No such suspended member to restore.",
        );
      }

      return {
        result: { id: updated.id, status: updated.status },
        activity: {
          kind: "member.restored",
          subjectType: "workspace_member",
          subjectId: updated.id,
          payload: { name: updated.name },
        },
        audit: {
          action: "people.restore",
          targetType: "workspace_member",
          targetId: updated.id,
        },
      };
    },
  }),
});

export const convertToGuest = defineWriteAction({
  name: "people.convertToGuest",
  summary: "Convert a member to a guest, stripping their prior bindings.",
  input: z.object({ memberId: z.uuid() }),
  output: z.object({ id: z.uuid(), kind: z.literal("guest") }),
  access: ACCESS_LEVELS.full,
  // Destructive scope (docs/design/irreversible-scope.md, plan 0.7.0 O6,
  // approved 9 November 2026): it takes a member's access to most of the workspace.
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      refuseIfLastOwner(
        await isLastFullAccessHolder(tx, workspaceId, input.memberId),
      );

      await stripBindings(tx, workspaceId, input.memberId);

      const [updated] = await tx
        .update(workspaceMembers)
        .set({ kind: "guest", updatedAt: new Date() })
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .returning({ id: workspaceMembers.id, name: workspaceMembers.name });
      if (!updated) {
        throw new OperationError("not_found", "No such member.");
      }

      return {
        result: { id: updated.id, kind: "guest" as const },
        activity: {
          kind: "member.converted_to_guest",
          subjectType: "workspace_member",
          subjectId: updated.id,
          payload: { name: updated.name },
        },
        audit: {
          action: "people.convertToGuest",
          targetType: "workspace_member",
          targetId: updated.id,
        },
      };
    },
  }),
});

/**
 * Everything the manifest marks as a member's own, as handed to them (P7-T08b).
 *
 * Rows are `unknown` on purpose: this is forty-odd tables wide and a schema
 * naming every column would be a second copy of the database schema, drifting
 * from the first. Shared by erasure, which hands it over before anonymising,
 * and by `people.exportMine`, which hands it over on request.
 */
const personalExportSchema = z.object({
  memberId: z.uuid(),
  takenAt: z.string(),
  tables: z
    .array(
      z.object({
        table: z.string(),
        label: z.string(),
        // Records rather than `unknown`: a row is a row, and the looser type
        // made this schema disagree with `PersonalExport` at the one call site
        // that consumes both.
        rows: z.array(z.record(z.string(), z.unknown())).readonly(),
      }),
    )
    .readonly(),
  omitted: z
    .array(
      z.object({
        table: z.string(),
        reason: z.enum([
          "structural",
          "access",
          "derived",
          "credential",
          "workspace_record",
        ]),
        because: z.string(),
      }),
    )
    .readonly(),
});

/**
 * A member's own data, whenever they ask (completeness review M-18).
 *
 * The export existed only inside erasure, so the one way to see what the
 * instance held about you was to be deleted. The same manifest and builder,
 * for the caller's own member only: there is no id in the input, so nobody can
 * ask for anybody else's.
 */
export const exportMine = defineReadAction({
  name: "people.exportMine",
  summary:
    "Everything this workspace holds about the signed-in member, as one document.",
  input: z.object({}),
  output: personalExportSchema,
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such member.");
    }
    const db = drizzle(context.pool);
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const [member] = await tx
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
              eq(workspaceMembers.userId, userId),
            ),
          )
          .limit(1);
        if (!member) {
          throw new OperationError("not_found", "No such member.");
        }
        return buildPersonalExport(tx, {
          workspaceId: context.workspaceId,
          memberId: member.id,
        });
      },
    );
  },
});

export const eraseMember = defineWriteAction({
  name: "people.erase",
  summary:
    "Anonymise a member: their history stays attributable to a " +
    "placeholder identity, and their personal data is exported first.",
  input: z.object({ memberId: z.uuid() }),
  output: z.object({
    id: z.uuid(),
    export: z.object({
      memberId: z.uuid(),
      erasedAt: z.string(),
      priorProfile: z.object({
        name: z.string(),
        title: z.string().nullable(),
        bio: z.unknown(),
        timezone: z.string().nullable(),
      }),
      /**
       * What the sweep removed, by table (P7-T08b).
       *
       * Handed back because "we deleted your data" is a claim and a count
       * per table is the nearest thing to evidence a person can be given.
       * The same object goes on the audit row, so a quarter later somebody
       * can see what an erasure actually did rather than only that one
       * happened.
       */
      /**
       * Everything the manifest marks as theirs, read before the sweep
       * ran (P7-T08b).
       *
       * Rows are `unknown` on purpose: this is forty-odd tables wide and a
       * schema naming every column would be a second copy of the database
       * schema, drifting from the first.
       */
      data: personalExportSchema,
      removed: z.object({
        channelIdentities: z.number(),
        channelLinkCodes: z.number(),
        channelMessages: z.number(),
        apiTokens: z.number(),
        oauthGrants: z.number(),
        oauthTokens: z.number(),
        copilotThreads: z.number(),
        copilotMessages: z.number(),
        agentToolCalls: z.number(),
        answerRatings: z.number(),
      }),
    }),
  }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (context, input) => ({
    async load({ tx, workspaceId }) {
      // The member and their export, read before a single row is anonymised
      // and on the same transaction (P7-T08b). This is the member's one
      // chance to be handed what the instance held.
      return loadMemberForErasure(tx, {
        workspaceId,
        memberId: input.memberId,
        withExport: true,
      });
    },
    async execute({ tx, workspaceId, loaded }) {
      // The one body a person's own deletion runs too (account-deletion.md
      // §3.3), so there is no second way to do half of it.
      const erasure = await eraseMemberInTx(tx, context.pool, {
        workspaceId,
        memberId: input.memberId,
        loaded,
      });
      const exported = erasureExport(erasure, loaded);

      return {
        result: { id: erasure.memberId, export: exported },
        activity: {
          kind: "member.erased",
          subjectType: "workspace_member",
          subjectId: erasure.memberId,
          // No name (completeness review M-18). This carried the name from
          // before erasure "because the row no longer does", which wrote the
          // one thing erasure removes into a new row the whole workspace can
          // read.
          payload: {},
        },
        audit: {
          action: "people.erase",
          targetType: "workspace_member",
          targetId: erasure.memberId,
          // What the sweep removed, so the trail records what the erasure
          // did and not only that it ran. No identifier is in here: these
          // are counts.
          payload: erasureAuditPayload(erasure),
        },
      };
    },
  }),
});

export const directory = defineReadAction({
  name: "people.directory",
  summary: "Every active member of the workspace.",
  input: z.object({
    /**
     * Include suspended members in the result. The directory page passes this
     * only when the signed-in member holds `full`, so the caller decides, not
     * the action. Existing callers all pass `{}` and keep the active-only
     * default (P6-G09).
     */
    includeSuspended: z.boolean().optional(),
    /**
     * Only members whose name or title holds every word typed, the closest
     * name first (guided-inputs §4.10): a picker over more members than the
     * browser filters asks this as the person types.
     */
    search: z.string().trim().min(1).max(200).optional(),
    /** Only these kinds: a champion is a person, never an agent. */
    kinds: z
      .array(z.enum(["human", "guest", "agent", "placeholder"]))
      .min(1)
      .optional(),
    /** At most this many, for a search. */
    limit: z.number().int().min(1).max(100).optional(),
  }),
  output: z.array(memberSummary),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, (tx) => {
      const filters = [eq(workspaceMembers.workspaceId, context.workspaceId)];
      if (!input.includeSuspended) {
        filters.push(eq(workspaceMembers.status, "active"));
      }
      if (input.kinds) {
        filters.push(inArray(workspaceMembers.kind, input.kinds));
      }
      const phrase = input.search ?? "";
      for (const word of phrase.split(/\s+/).filter(Boolean).slice(0, 6)) {
        const like = `%${escapeLike(word)}%`;
        filters.push(
          or(
            ilike(workspaceMembers.name, like),
            ilike(workspaceMembers.title, like),
          ) as SQL,
        );
      }
      const query = tx
        .select({
          id: workspaceMembers.id,
          name: workspaceMembers.name,
          title: workspaceMembers.title,
          kind: workspaceMembers.kind,
          status: workspaceMembers.status,
          managerId: workspaceMembers.managerId,
          timezone: workspaceMembers.timezone,
          roleId: workspaceMembers.roleId,
        })
        .from(workspaceMembers)
        .where(activeOnly(workspaceMembers, ...filters));
      if (phrase === "") {
        return input.limit ? query.limit(input.limit) : query;
      }
      // A name that starts with it, then a word in the name that does, then
      // the rest, which matched on a title or inside a word.
      const start = escapeLike(phrase);
      return query
        .orderBy(
          desc(ilike(workspaceMembers.name, `${start}%`)),
          desc(ilike(workspaceMembers.name, `% ${start}%`)),
          desc(ilike(workspaceMembers.name, `%${start}%`)),
          asc(workspaceMembers.name),
        )
        .limit(input.limit ?? 50);
    });
  },
});

/**
 * `%`, `_` and the backslash mean something to `LIKE`, and a person typing
 * "50%" means the character. Backslash is Postgres's default escape.
 */
const escapeLike = (text: string) =>
  text.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

const memberProfile = z.object({
  id: z.uuid(),
  name: z.string(),
  title: z.string().nullable(),
  kind: z.enum(["human", "guest", "agent", "placeholder"]),
  status: z.enum(["active", "invited", "suspended"]),
  managerId: z.uuid().nullable(),
  timezone: z.string().nullable(),
  bio: z.unknown().nullable(),
  bioVersion: z.number().nullable(),
  avatarBlobId: z.uuid().nullable(),
  primaryChannel: z
    .enum(["app", "email", "slack", "teams", "whatsapp", "telegram"])
    .nullable(),
  /**
   * How the product looks to this member (P6-G23).
   *
   * Null is "follow the system", which is what the theme provider does with
   * no stored value. Returned so the shell can apply a member's own choice on
   * a browser that has never seen it, which is what makes the preference
   * follow them rather than the machine.
   */
  theme: z.enum(["light", "dark", "system"]).nullable(),
  density: z.enum(["comfortable", "compact"]).nullable(),
  /**
   * Which catalogue renders for this member (P6-G22a).
   *
   * Null is "follow the workspace". Returned so the root layout can decide
   * the locale on the server, which is the only place it can be decided: the
   * text is rendered there.
   */
  language: z.enum(["en", "ms"]).nullable(),
  /**
   * The name of this member's workspace role: Owner, Admin, Member, Viewer or
   * one the workspace made (plan 0.8.0 Y1). Null for a guest, an agent and a
   * placeholder, which hold no workspace-wide role. The avatar menu says it
   * beside the person's name, so they know what they should expect to do.
   */
  roleName: z.string().nullable(),
  /**
   * The role's built-in key, or null for a role the workspace made. A built-in
   * role cannot be renamed, so a screen may name it in the reader's language
   * (UAT 0.8.0, F-08).
   */
  roleKey: z.enum(BUILTIN_ROLE_KEYS).nullable(),
});

/**
 * A single member's profile (P6-G09, screen S-33).
 *
 * The directory returns a summary per member. A profile page needs the bio,
 * avatar and primary channel as well, so a separate read exists for one row.
 *
 * Suspended members are visible only to callers holding `full` on the
 * workspace context. For anyone else the handler returns `not_found`, which
 * is the same shape the access getter uses: revealing that a member exists
 * but is suspended would be an oracle.
 */
export const readMember = defineReadAction({
  name: "people.readMember",
  summary: "One member's profile.",
  input: z.object({ memberId: z.uuid() }),
  output: memberProfile,
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId: userId ?? "" },
      async (tx) => {
        const [row] = await tx
          .select({
            id: workspaceMembers.id,
            name: workspaceMembers.name,
            title: workspaceMembers.title,
            kind: workspaceMembers.kind,
            status: workspaceMembers.status,
            managerId: workspaceMembers.managerId,
            timezone: workspaceMembers.timezone,
            bio: workspaceMembers.bio,
            bioVersion: workspaceMembers.bioVersion,
            avatarBlobId: workspaceMembers.avatarBlobId,
            primaryChannel: workspaceMembers.primaryChannel,
            theme: workspaceMembers.theme,
            density: workspaceMembers.density,
            language: workspaceMembers.language,
            roleName: workspaceRoles.name,
            roleKey: workspaceRoles.builtinKey,
          })
          .from(workspaceMembers)
          // A removed role names nothing, as no role does.
          .leftJoin(
            workspaceRoles,
            and(
              eq(workspaceRoles.id, workspaceMembers.roleId),
              isNull(workspaceRoles.deletedAt),
            ),
          )
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.id, input.memberId),
              eq(workspaceMembers.workspaceId, context.workspaceId),
            ),
          )
          .limit(1);

        if (!row) {
          throw new OperationError("not_found", "No such member.");
        }

        // A suspended member is visible only to an admin. Resolve the
        // caller's level on the workspace context and hide when below full.
        if (row.status === "suspended") {
          if (!userId) {
            throw new OperationError("not_found", "No such member.");
          }
          const [caller] = await tx
            .select({ id: workspaceMembers.id })
            .from(workspaceMembers)
            .where(
              activeOnly(
                workspaceMembers,
                eq(workspaceMembers.workspaceId, context.workspaceId),
                eq(workspaceMembers.userId, userId),
                eq(workspaceMembers.status, "active"),
              ),
            )
            .limit(1);
          if (!caller) {
            throw new OperationError("not_found", "No such member.");
          }
          const wsContext = await resolveSubjectContext(
            tx,
            "workspace",
            context.workspaceId,
            context.workspaceId,
          );
          if (!wsContext) {
            throw new OperationError("not_found", "No such member.");
          }
          const level = await resolveMemberAccessLevel(tx, {
            workspaceId: context.workspaceId,
            memberId: caller.id,
            contextId: wsContext.contextId,
          });
          if (level < ACCESS_LEVELS.full) {
            throw new OperationError("not_found", "No such member.");
          }
        }

        return row;
      },
    );
  },
});

export const orgChart = defineReadAction({
  name: "people.orgChart",
  summary: "The manager chain as a tree.",
  input: z.object({}),
  output: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      title: z.string().nullable(),
      children: z.array(z.unknown()),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, (tx) =>
      buildOrgChart(tx, context.workspaceId),
    );
  },
});

export const possibleManagersFor = defineReadAction({
  name: "people.possibleManagers",
  summary: "Every member who could safely become this member's manager.",
  input: z.object({ memberId: z.uuid() }),
  output: z.array(z.object({ id: z.uuid(), name: z.string() })),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, (tx) =>
      possibleManagers(tx, context.workspaceId, input.memberId),
    );
  },
});

/**
 * A member an import created, standing in for somebody who has not signed in
 * (TECHNICAL-PLAN §7.2, P6-T03a).
 *
 * **Why an action of its own rather than the invitation path.** Every member in
 * this product is born from an invitation somebody accepted, and that path
 * verifies an address by delivering to it. An import has neither: it has a row
 * in somebody else's database saying this person owned that objective. Widening
 * `invitations.acceptLink` with a mode that skips the verification would put a
 * branch in a security path for the benefit of a migration, which is the wrong
 * trade. Agung chose this shape on 4 September 2026 over that and over importing
 * with no members at all.
 *
 * **A placeholder is not an account and cannot become one by accident.** It has
 * no `user_id`, so nobody can sign in as it, and it holds the address the source
 * knew the person by so that a real account can be matched to it later. Claiming
 * is not built here: the row is what makes it possible.
 *
 * **`full`, and a legacy key is required.** Creating people is an administrative
 * act, and requiring the key is what keeps this an importer's action rather than
 * a second way to add members: there is no call to it that is not part of a
 * recorded import run.
 */
export const importMember = defineWriteAction({
  name: "people.importMember",
  agentSurface: false,
  summary:
    "Creates a placeholder member for somebody an import found, with the address to claim it by.",
  input: z.object({
    name: z.string().trim().min(1).max(200),
    /** The address the source system knew them by. */
    email: z.email({ pattern: EMAIL_PATTERN }).max(320),
    title: z.string().trim().max(200).optional(),
    timezone: z.string().trim().max(64).optional(),
    /** Required: this action exists for imports and for nothing else. */
    legacy: legacyKey,
  }),
  output: z.object({
    memberId: z.uuid(),
    /** False when a member already held this address or this key. */
    created: z.boolean(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const email = input.email.trim().toLowerCase();

      // Three ways this person may already be here, and each is a match rather
      // than a refusal: a re-run of the same import, an earlier import that
      // found them under a different source row, and a real member whose
      // account already carries the address. An import is expected to run
      // twice, so "already here" is the normal case and not an error.
      const byLegacy = await findLegacyRowInTx(
        tx,
        workspaceId,
        workspaceMembers,
        input.legacy,
      );
      if (byLegacy) {
        return {
          result: { memberId: byLegacy.id, created: false },
          activity: {
            kind: "member.imported" as const,
            subjectType: "workspace" as const,
            subjectId: workspaceId,
            payload: { name: input.name, matched: "legacy" },
          },
          audit: {
            action: "people.importMember",
            targetType: "workspace_member",
            targetId: byLegacy.id,
            payload: { legacyId: input.legacy.id, matched: "legacy" },
          },
        };
      }

      const [existing] = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, workspaceId),
            sql`(
              ${workspaceMembers.placeholderEmail} = ${email}
              or exists (
                select 1 from users u
                 where u.id = ${workspaceMembers.userId}
                   and lower(u.email) = ${email}
              )
            )`,
          ),
        )
        .limit(1);
      if (existing) {
        // Claim it for the import by writing the legacy key onto the member who
        // is already here, so the next run resolves by key and every later
        // mapper points at one member rather than two.
        // openokr:allow-mutation: the calling Operation's own transaction.
        await tx
          .update(workspaceMembers)
          .set({
            legacyType: input.legacy.type,
            legacyId: input.legacy.id,
            updatedAt: new Date(),
          })
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.id, existing.id),
            ),
          );
        return {
          result: { memberId: existing.id, created: false },
          activity: {
            kind: "member.imported" as const,
            subjectType: "workspace" as const,
            subjectId: workspaceId,
            payload: { name: input.name, matched: "email" },
          },
          audit: {
            action: "people.importMember",
            targetType: "workspace_member",
            targetId: existing.id,
            payload: { legacyId: input.legacy.id, matched: "email" },
          },
        };
      }

      const settings = resolveMemberSettings({});
      // openokr:allow-mutation: the calling Operation's own transaction.
      const [member] = await tx
        .insert(workspaceMembers)
        .values({
          workspaceId,
          userId: null,
          name: input.name,
          title: input.title ?? null,
          timezone: input.timezone ?? null,
          placeholderEmail: email,
          kind: "placeholder",
          // **`active`, with `placeholder` as the kind.** The two columns answer
          // different questions and it is worth being precise about which. The
          // kind says nobody has signed in as this row yet. The status says
          // whether the membership is live, and an imported member's is: they
          // champion objectives that came across, they belong to spaces, and
          // work is assigned to them. `invited` was tried first and every
          // imported objective was refused, because a champion has to be an
          // active member. The fix is not to relax that rule but to stop
          // describing a live membership as a pending one (P6-T03b).
          status: "active",
          primaryChannel:
            settings.primaryChannel as typeof workspaceMembers.$inferInsert.primaryChannel,
          quietHours: settings.quietHours,
          legacyType: input.legacy.type,
          legacyId: input.legacy.id,
        })
        .returning({ id: workspaceMembers.id });
      if (!member) {
        throw new Error("The placeholder member insert returned no row.");
      }

      // The member's own group and its workspace binding, the same two rows
      // `provisionMemberForInvite` writes. Without them the member exists and
      // reaches nothing, and every later mapper naming them as a champion would
      // write a goal nobody can see.
      const groupId = await ensureMemberGroup(tx, {
        workspaceId,
        memberId: member.id,
      });
      const context = await resolveSubjectContext(
        tx,
        "workspace",
        workspaceId,
        workspaceId,
      );
      if (context) {
        await bindGroup(tx, {
          workspaceId,
          groupId,
          contextId: context.contextId,
          level: ACCESS_LEVELS.edit,
        });
      }

      return {
        result: { memberId: member.id, created: true },
        activity: {
          kind: "member.imported" as const,
          subjectType: "workspace" as const,
          subjectId: workspaceId,
          payload: { name: input.name, legacyId: input.legacy.id },
        },
        audit: {
          action: "people.importMember",
          targetType: "workspace_member",
          targetId: member.id,
          payload: {
            name: input.name,
            legacyType: input.legacy.type,
            legacyId: input.legacy.id,
          },
        },
      };
    },
  }),
});
