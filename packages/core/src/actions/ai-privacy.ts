/**
 * The privacy card's read and write (AI-NATIVE-PLAN §4, S-37, completeness
 * review M-10).
 *
 * The card was three paragraphs of static text. These are what it reads and
 * saves now: the workspace's four AI egress controls, stored in
 * `workspaces.settings` under the registry's own keys and schemas, so the
 * general reset action restores them like any other card.
 *
 * `full`, like every other card on the AI console. A control that decides
 * what content leaves the instance is a workspace administrator's decision.
 */
import { activeOnly, type WorkspaceSettings, workspaces } from "@openokr/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  AI_PRIVACY_KEYS,
  aiPrivacyFrom,
  resolveAIPrivacySettings,
} from "../ai/egress.ts";
import { OperationError } from "../operations/operation.ts";
import {
  aiContextEgressSchema,
  aiEgressAllowListSchema,
} from "../settings/registry.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const privacyOutput = z.object({
  contextEgress: aiContextEgressSchema,
  redactPersonalData: z.boolean(),
  noTraining: z.boolean(),
  allowedHosts: z.array(z.string()),
});

export const readPrivacySettings = defineReadAction({
  name: "ai.readPrivacySettings",
  summary:
    "The workspace's AI egress controls: context level, personal-data redaction, no-training and the host allow-list.",
  input: z.object({}),
  output: privacyOutput,
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const settings = await resolveAIPrivacySettings(
      context.pool,
      context.workspaceId,
    );
    return { ...settings, allowedHosts: [...settings.allowedHosts] };
  },
});

export const updatePrivacySettings = defineWriteAction({
  name: "ai.updatePrivacySettings",
  summary:
    "Change what may leave for an AI provider off this network: the context level, redaction, no-training and the host allow-list.",
  input: z
    .object({
      contextEgress: aiContextEgressSchema.optional(),
      redactPersonalData: z.boolean().optional(),
      noTraining: z.boolean().optional(),
      allowedHosts: aiEgressAllowListSchema.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "nothing to update",
    }),
  output: privacyOutput,
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
      if (input.contextEgress !== undefined) {
        patch[AI_PRIVACY_KEYS.contextEgress] = input.contextEgress;
      }
      if (input.redactPersonalData !== undefined) {
        patch[AI_PRIVACY_KEYS.redactPersonalData] = input.redactPersonalData;
      }
      if (input.noTraining !== undefined) {
        patch[AI_PRIVACY_KEYS.noTraining] = input.noTraining;
      }
      if (input.allowedHosts !== undefined) {
        // Once each, in the order given: a host listed twice is one host.
        patch[AI_PRIVACY_KEYS.allowedHosts] = [...new Set(input.allowedHosts)];
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

      const resolved = aiPrivacyFrom(updated.settings);
      const keys = Object.keys(patch);
      return {
        result: { ...resolved, allowedHosts: [...resolved.allowedHosts] },
        activity: {
          kind: "ai.privacy_updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { keys },
        },
        audit: {
          action: "ai.updatePrivacySettings",
          targetType: "workspace",
          targetId: workspaceId,
          // The values themselves: a level, two switches and host names,
          // none of which is personal data, and all of which an auditor
          // asking "when did this start leaving?" needs.
          payload: patch,
        },
      };
    },
  }),
});
