/**
 * Workspace settings actions (TECHNICAL-PLAN §4.14, screen S-36, P2-T08).
 *
 * Two cards exist today: general (timezone, language, trusted email
 * domains) and branding. Every other S-36 card — members and access,
 * spaces, rhythm, thresholds, coaching, nudges, notifications and channels,
 * authentication, the audit log, the freeze switch, backups, import and
 * export — arrives with the module that owns its storage, the same way
 * `SETTINGS_REGISTRY` itself grows. The workspace's name and slug stay on
 * `workspace.rename` (P1-T07): that action is already the single writer for
 * the columns it owns, and duplicating it here would give the name two
 * writers for no reason the plan asks for.
 */
import {
  activeOnly,
  type WorkspaceSettings,
  withContext,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { OperationError } from "../operations/operation.ts";
import {
  brandingSchema,
  findSetting,
  languageSchema,
  settingsByCard,
  timezoneSchema,
  trustedEmailDomainsSchema,
} from "../settings/registry.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const settingsValue = z.record(z.string(), z.unknown());

export const readWorkspaceSettings = defineReadAction({
  name: "settings.readWorkspaceSettings",
  summary: "The workspace's own settings map, for the admin cards.",
  input: z.object({}),
  output: z.object({ workspaceId: z.uuid(), settings: settingsValue }),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError(
        "not_found",
        "No such workspace, or you are not a member of it.",
      );
    }

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
          throw new OperationError(
            "not_found",
            "No such workspace, or you are not a member of it.",
          );
        }

        // The one enforcement point: an admin card is exactly the kind of
        // read `getAccessScoped` exists for, same as workspace.overview.
        await getAccessScoped(tx, {
          workspaceId: context.workspaceId,
          memberId: member.id,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.full,
        });

        const [workspace] = await tx
          .select({ settings: workspaces.settings })
          // openokr:allow-raw-read: access was just confirmed above; this
          // loads the row's own settings column, which the getter itself
          // does not return.
          .from(workspaces)
          .where(activeOnly(workspaces, eq(workspaces.id, context.workspaceId)))
          .limit(1);
        if (!workspace) {
          throw new OperationError(
            "not_found",
            "No such workspace, or you are not a member of it.",
          );
        }

        return {
          workspaceId: context.workspaceId,
          settings: workspace.settings,
        };
      },
    );
  },
});

export const updateWorkspaceGeneralSettings = defineWriteAction({
  name: "settings.updateWorkspaceGeneral",
  summary:
    "Change the workspace's timezone, language or trusted email domains.",
  input: z
    .object({
      timezone: timezoneSchema.optional(),
      language: languageSchema.optional(),
      trustedEmailDomains: trustedEmailDomainsSchema.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "nothing to update",
    }),
  output: z.object({ workspaceId: z.uuid(), settings: settingsValue }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [current] = await tx
        .select({ settings: workspaces.settings })
        .from(workspaces)
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .limit(1);
      if (!current) {
        throw new OperationError("not_found", "No such workspace.");
      }
      return current.settings;
    },
    async execute({ tx, workspaceId, loaded }) {
      const patch: Record<string, unknown> = {};
      if (input.timezone !== undefined) {
        patch.timezone = input.timezone;
      }
      if (input.language !== undefined) {
        patch.language = input.language;
      }
      if (input.trustedEmailDomains !== undefined) {
        patch.trustedEmailDomains = input.trustedEmailDomains;
      }
      const nextSettings: WorkspaceSettings = { ...loaded, ...patch };

      // openokr:allow-mutation: this is the operation's own execute, on the
      // transaction runOperation opened. The change, the activity and the
      // audit row commit together.
      const [updated] = await tx
        .update(workspaces)
        .set({ settings: nextSettings, updatedAt: new Date() })
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .returning({ settings: workspaces.settings });
      if (!updated) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const keys = Object.keys(patch);
      return {
        result: { workspaceId, settings: updated.settings },
        activity: {
          kind: "workspace.general_settings_updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { keys },
        },
        audit: {
          action: "settings.update_workspace_general",
          targetType: "workspace",
          targetId: workspaceId,
          payload: patch,
        },
      };
    },
  }),
});

export const updateWorkspaceBranding = defineWriteAction({
  name: "settings.updateWorkspaceBranding",
  summary: "Replace the workspace's branding.",
  input: z.object({ branding: brandingSchema }),
  output: z.object({ workspaceId: z.uuid(), settings: settingsValue }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [current] = await tx
        .select({ settings: workspaces.settings })
        .from(workspaces)
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .limit(1);
      if (!current) {
        throw new OperationError("not_found", "No such workspace.");
      }
      return current.settings;
    },
    async execute({ tx, workspaceId, loaded }) {
      const nextSettings: WorkspaceSettings = {
        ...loaded,
        branding: input.branding,
      };

      // openokr:allow-mutation: same transaction, same reason as
      // settings.updateWorkspaceGeneral above.
      const [updated] = await tx
        .update(workspaces)
        .set({ settings: nextSettings, updatedAt: new Date() })
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .returning({ settings: workspaces.settings });
      if (!updated) {
        throw new OperationError("not_found", "No such workspace.");
      }

      return {
        result: { workspaceId, settings: updated.settings },
        activity: {
          kind: "workspace.branding_updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { branding: input.branding },
        },
        audit: {
          action: "settings.update_workspace_branding",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { branding: input.branding },
        },
      };
    },
  }),
});

const resetInput = z.union([
  z.object({ key: z.string() }),
  z.object({ card: z.string() }),
]);

/** Every workspace-scoped setting a reset request names, registry-validated. */
function settingsToReset(input: z.infer<typeof resetInput>) {
  if ("key" in input) {
    const setting = findSetting(input.key);
    if (!setting || setting.scope !== "workspace") {
      throw new OperationError(
        "not_found",
        `"${input.key}" is not a workspace setting.`,
      );
    }
    return [setting];
  }
  const settings = settingsByCard(input.card).filter(
    (setting) => setting.scope === "workspace",
  );
  if (settings.length === 0) {
    throw new OperationError(
      "not_found",
      `No workspace setting is on the "${input.card}" card.`,
    );
  }
  return settings;
}

export const resetWorkspaceSettings = defineWriteAction({
  name: "settings.resetWorkspaceSettings",
  summary:
    "Reset one workspace setting, or a whole admin card, to its default.",
  input: resetInput,
  output: z.object({ workspaceId: z.uuid(), settings: settingsValue }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [current] = await tx
        .select({ settings: workspaces.settings })
        .from(workspaces)
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .limit(1);
      if (!current) {
        throw new OperationError("not_found", "No such workspace.");
      }
      return current.settings;
    },
    async execute({ tx, workspaceId, loaded }) {
      const targets = settingsToReset(input);
      // No browser signal is available from an admin screen the way one is
      // at registration, so a reset resolves each setting the same way the
      // registry itself falls back: with no context at all.
      const patch = Object.fromEntries(
        targets.map((setting) => [setting.key, setting.resolve({})]),
      );
      const nextSettings: WorkspaceSettings = { ...loaded, ...patch };

      // openokr:allow-mutation: same transaction, same reason as the two
      // actions above.
      const [updated] = await tx
        .update(workspaces)
        .set({ settings: nextSettings, updatedAt: new Date() })
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .returning({ settings: workspaces.settings });
      if (!updated) {
        throw new OperationError("not_found", "No such workspace.");
      }

      return {
        result: { workspaceId, settings: updated.settings },
        activity: {
          kind: "workspace.settings_reset",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { keys: targets.map((setting) => setting.key) },
        },
        audit: {
          action: "settings.reset_workspace_settings",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { keys: targets.map((setting) => setting.key) },
        },
      };
    },
  }),
});
