/**
 * People actions (TECHNICAL-PLAN §4.1, screen S-33, P2-T03).
 *
 * **Self versus others.** `updateOwnProfile` is timezone, avatar and bio: the
 * fields that are nobody else's business. `updateMember` is name, title and
 * manager: the org-structural fields, editable only by someone holding
 * `full` on the workspace's own context, which today means whoever
 * provisioning gave a personal binding to. This split is this task's own
 * reading of "self-versus-others editable field sets" — TECHNICAL-PLAN
 * §4.1 names the property without drawing the line, so it is recorded here
 * and in STATUS.md for a human to confirm rather than assumed silently.
 *
 * **Suspend, restore, convert, erase** all require `full` and, except
 * restore, all refuse to act on the workspace's last full-access holder
 * (`isLastFullAccessHolder` in `../people/lifecycle.ts`).
 */
import { activeOnly, withWorkspace, workspaceMembers } from "@openokr/db";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { bindGroup, ensureMemberGroup } from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { resolveSubjectContext } from "../access/reads.ts";
import { findLegacyRowInTx, legacyKey } from "../imports/legacy.ts";
import { OperationError } from "../operations/operation.ts";
import {
  type ErasureExport,
  isLastFullAccessHolder,
  refuseIfLastOwner,
  stripBindings,
} from "../people/lifecycle.ts";
import {
  buildOrgChart,
  possibleManagers,
  wouldCreateManagerCycle,
} from "../people/manager-chain.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";
import {
  isKnownTimezone,
  resolveMemberSettings,
} from "../settings/registry.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/** `null` clears the bio; anything else must be a valid rich text
 * document (docs/design/rich-text-editor.md). Validated at the input
 * boundary, same as `isKnownTimezone` below, rather than inside
 * `execute()` — a bad document is refused before the transaction opens. */
const bioInputSchema = z
  .unknown()
  .nullable()
  .refine(
    (value) =>
      value === null || isValidRichText(value, RICH_TEXT_SCHEMA_VERSION),
    {
      message: "bio must be a valid rich text document.",
    },
  )
  .optional();

const memberSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  title: z.string().nullable(),
  kind: z.enum(["human", "guest", "agent", "placeholder"]),
  status: z.enum(["active", "invited", "suspended"]),
  managerId: z.uuid().nullable(),
  timezone: z.string().nullable(),
});

export const updateOwnProfile = defineWriteAction({
  name: "people.updateOwnProfile",
  summary:
    "Update the signed-in member's own timezone, avatar, bio, primary channel or quiet hours.",
  input: z.object({
    timezone: z
      .string()
      .refine(isKnownTimezone, { message: "Unknown timezone." })
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
     * When not to be messaged, in the member's own timezone.
     *
     * Null clears it. AI-NATIVE-PLAN §5.4 defers a nudge inside this window to
     * the next open one rather than dropping it, so setting a window loses
     * nothing.
     */
    quietHours: z
      .object({
        start: z.string().regex(/^\d{1,2}:\d{2}$/, "Use HH:MM."),
        end: z.string().regex(/^\d{1,2}:\d{2}$/, "Use HH:MM."),
      })
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
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("forbidden", "No member to update.");
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.timezone !== undefined) {
        patch.timezone = input.timezone;
      }
      if (input.avatarBlobId !== undefined) {
        patch.avatarBlobId = input.avatarBlobId;
      }
      if (input.bio !== undefined) {
        patch.bio = input.bio;
        patch.bioVersion = sql`coalesce(${workspaceMembers.bioVersion}, 0) + 1`;
      }
      if (input.primaryChannel !== undefined) {
        patch.primaryChannel = input.primaryChannel;
      }
      if (input.quietHours !== undefined) {
        patch.quietHours = input.quietHours;
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
        });
      if (!updated) {
        throw new OperationError("not_found", "No such member.");
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
    name: z.string().trim().min(1).max(200).optional(),
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
    }),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [before] = await tx
        .select({
          name: workspaceMembers.name,
          title: workspaceMembers.title,
          bio: workspaceMembers.bio,
          timezone: workspaceMembers.timezone,
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
      if (!before) {
        throw new OperationError("not_found", "No such member.");
      }
      return before;
    },
    async execute({ tx, workspaceId, loaded }) {
      refuseIfLastOwner(
        await isLastFullAccessHolder(tx, workspaceId, input.memberId),
      );

      const erasedAt = new Date();
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
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .returning({ id: workspaceMembers.id });
      if (!updated) {
        throw new OperationError("not_found", "No such member.");
      }

      const exported: ErasureExport = {
        memberId: updated.id,
        erasedAt: erasedAt.toISOString(),
        priorProfile: {
          name: loaded.name,
          title: loaded.title,
          bio: loaded.bio,
          timezone: loaded.timezone,
        },
      };

      return {
        result: { id: updated.id, export: exported },
        activity: {
          kind: "member.erased",
          subjectType: "workspace_member",
          subjectId: updated.id,
          // The name from before erasure: the whole point of erasure is
          // that the row no longer carries it, so the feed entry has to.
          payload: { name: loaded.name },
        },
        audit: {
          action: "people.erase",
          targetType: "workspace_member",
          targetId: updated.id,
        },
      };
    },
  }),
});

export const directory = defineReadAction({
  name: "people.directory",
  summary: "Every active member of the workspace.",
  input: z.object({}),
  output: z.array(memberSummary),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, (tx) =>
      tx
        .select({
          id: workspaceMembers.id,
          name: workspaceMembers.name,
          title: workspaceMembers.title,
          kind: workspaceMembers.kind,
          status: workspaceMembers.status,
          managerId: workspaceMembers.managerId,
          timezone: workspaceMembers.timezone,
        })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, context.workspaceId),
            eq(workspaceMembers.status, "active"),
          ),
        ),
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
  summary:
    "Creates a placeholder member for somebody an import found, with the address to claim it by.",
  input: z.object({
    name: z.string().trim().min(1).max(200),
    /** The address the source system knew them by. */
    email: z.email().max(320),
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
          // `invited`, not `active`: nobody has accepted anything. The status is
          // what tells every count of "people in this workspace" that this is a
          // row waiting for a person rather than a person.
          status: "invited",
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
