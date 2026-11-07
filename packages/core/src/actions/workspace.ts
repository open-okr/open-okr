/**
 * Workspace actions (TECHNICAL-PLAN §14).
 *
 * Two to start with, chosen because between them they exercise every stage of
 * the pipeline: `workspace.provision` is the bootstrap case with a system
 * actor and no workspace to load, and `workspace.rename` is the ordinary case
 * with a human actor, a freshly loaded row and a side effect.
 */
import { activeOnly, workspaces } from "@openokr/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { OperationError } from "../operations/operation.ts";
import { setTenantStateInTx } from "../tenancy/index.ts";
import { createOwnWorkspace } from "../workspaces/create-own.ts";
import { createWorkspace } from "../workspaces/provisioning.ts";
import { defineWriteAction } from "./define.ts";

const workspaceSummary = z.object({
  workspaceId: z.uuid(),
  name: z.string(),
  slug: z.string(),
});

export const renameWorkspace = defineWriteAction({
  name: "workspace.rename",
  summary: "Change a workspace's display name.",
  input: z.object({
    // Trimmed before the bound is checked, so a name of spaces is refused
    // rather than stored.
    name: z.string().trim().min(1).max(200),
  }),
  output: workspaceSummary,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    // Freshly loaded, inside the transaction that will do the writing. The
    // rename needs the old name for its audit payload, and loading it here
    // rather than trusting a value from the caller is what makes the trail
    // describe what actually changed.
    async load({ tx, workspaceId }) {
      const [current] = await tx
        .select({ name: workspaces.name, slug: workspaces.slug })
        .from(workspaces)
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .limit(1);
      if (!current) {
        throw new OperationError("not_found", "No such workspace.");
      }
      return current;
    },
    async execute({ tx, workspaceId, loaded }) {
      const [updated] = await tx
        .update(workspaces)
        .set({ name: input.name, updatedAt: new Date() })
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .returning({ name: workspaces.name, slug: workspaces.slug });

      if (!updated) {
        throw new OperationError("not_found", "No such workspace.");
      }

      return {
        result: { workspaceId, name: updated.name, slug: updated.slug },
        activity: {
          kind: "workspace.renamed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { from: loaded.name, to: updated.name },
        },
        audit: {
          action: "workspace.rename",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { from: loaded.name, to: updated.name },
        },
        outbox: [
          {
            topic: "workspace.renamed",
            payload: { workspaceId, from: loaded.name, to: updated.name },
            // One delivery per rename. Renaming back and forth is two
            // distinct events, so the key includes both ends.
            idempotencyKey: `workspace.renamed:${workspaceId}:${loaded.name}:${updated.name}`,
          },
        ],
      };
    },
  }),
});

export const finishOnboarding = defineWriteAction({
  name: "workspace.finishOnboarding",
  summary:
    "Mark the workspace's own setup as finished, so the wizard stops offering itself.",
  input: z.object({}),
  output: z.object({ workspaceId: z.uuid(), onboardingDone: z.boolean() }),
  // `full`, because it decides what every member of the workspace sees on
  // their next navigation. Onboarding is the owner's, and P6-G26's acceptance
  // line says "a first sign-in as owner".
  access: ACCESS_LEVELS.full,
  operation: () => ({
    async execute({ tx, workspaceId }) {
      // **Merged into the stored map rather than replacing it.** Every other
      // key in `workspaces.settings` belongs to somebody else, and a write
      // that set the whole object would silently reset the timezone the
      // registering browser reported.
      const [updated] = await tx
        .update(workspaces)
        .set({
          settings: sql`coalesce(${workspaces.settings}, '{}'::jsonb) || '{"onboardingDone": true}'::jsonb`,
          updatedAt: new Date(),
        })
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .returning({ id: workspaces.id });
      if (!updated) {
        throw new OperationError("not_found", "No such workspace.");
      }

      return {
        result: { workspaceId, onboardingDone: true },
        activity: {
          kind: "workspace.onboarded",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: {},
        },
        audit: {
          action: "workspace.finish_onboarding",
          targetType: "workspace",
          targetId: workspaceId,
          payload: {},
        },
      };
    },
  }),
});

/**
 * Offers S-34 again, from General in admin (UIUX-PLAN S-34, completeness
 * review L-08).
 *
 * **"A dismissed onboarding is resumable from admin", and it was not.** Once
 * `onboardingDone` was true the wizard sent everybody home, and nothing could
 * set it back, so an owner who skipped every step on the first day could never
 * see the offer again.
 *
 * **It flips the one flag and nothing else.** Every answer the wizard asks for
 * lives in its own setting, and the wizard opens on what the workspace holds
 * now, so reopening it forgets nothing: skipping a step keeps the answer, and
 * the template and the demo each refuse a workspace that already holds goals.
 */
export const reopenOnboarding = defineWriteAction({
  name: "workspace.reopenOnboarding",
  summary:
    "Offer the workspace's own setup again, keeping every answer it already holds.",
  input: z.object({}),
  output: z.object({ workspaceId: z.uuid(), onboardingDone: z.boolean() }),
  // `full`, like the finish it undoes: it decides what every administrator
  // meets on their next visit to the Work Map.
  access: ACCESS_LEVELS.full,
  operation: () => ({
    async execute({ tx, workspaceId }) {
      // Merged into the stored map, for the reason `finishOnboarding` gives:
      // every other key in it belongs to somebody else.
      const [updated] = await tx
        .update(workspaces)
        .set({
          settings: sql`coalesce(${workspaces.settings}, '{}'::jsonb) || '{"onboardingDone": false}'::jsonb`,
          updatedAt: new Date(),
        })
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .returning({ id: workspaces.id });
      if (!updated) {
        throw new OperationError("not_found", "No such workspace.");
      }

      return {
        result: { workspaceId, onboardingDone: false },
        activity: {
          kind: "workspace.onboarding_reopened",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: {},
        },
        audit: {
          action: "workspace.reopen_onboarding",
          targetType: "workspace",
          targetId: workspaceId,
          payload: {},
        },
      };
    },
  }),
});

export const setWorkspaceState = defineWriteAction({
  name: "workspace.setState",
  summary: "Set the workspace to active, read-only or frozen.",
  input: z.object({ state: z.enum(["active", "read_only", "frozen"]) }),
  output: workspaceSummary.extend({
    state: z.enum(["active", "read_only", "frozen"]),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    // On the freeze overlay's own recovery list (packages/core/src/
    // operations/freeze.ts): the one write that must survive a freeze is
    // the one that lifts it, so this action itself never refuses on the
    // workspace's own state, only on the caller's access level.
    async load({ tx, workspaceId }) {
      const [current] = await tx
        .select({
          name: workspaces.name,
          slug: workspaces.slug,
          state: workspaces.state,
        })
        .from(workspaces)
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .limit(1);
      if (!current) {
        throw new OperationError("not_found", "No such workspace.");
      }
      return current;
    },
    async execute({ tx, workspaceId, loaded }) {
      const [updated] = await tx
        .update(workspaces)
        .set({ state: input.state, updatedAt: new Date() })
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .returning({
          name: workspaces.name,
          slug: workspaces.slug,
          state: workspaces.state,
        });
      if (!updated) {
        throw new OperationError("not_found", "No such workspace.");
      }

      return {
        result: {
          workspaceId,
          name: updated.name,
          slug: updated.slug,
          state: updated.state,
        },
        activity: {
          kind: "workspace.state_changed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { from: loaded.state, to: updated.state },
        },
        audit: {
          action: "workspace.set_state",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { from: loaded.state, to: updated.state },
        },
      };
    },
  }),
});

/**
 * Provisioning, declared here so an audit row reading `workspace.provision`
 * resolves back to a contract like every other action.
 *
 * Its handler does not use `defineWriteAction`'s operation wrapper, because
 * the workspace it runs in does not exist until the operation runs. The
 * pipeline is still the only thing that writes: `createWorkspace` is itself an
 * operation, which is what `runsThroughPipeline` records.
 */
export const provisionWorkspace = {
  name: "workspace.provision" as const,
  agentSurface: false as const,
  summary:
    "Start a workspace of your own, where sign-up is open to you. Refused under an invitation-only policy.",
  input: z.object({
    /** Who it is for. A person may only name themselves, so may leave it out. */
    user: z
      .object({ id: z.string().min(1), name: z.string().min(1) })
      .optional(),
    name: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().optional(),
  }),
  output: workspaceSummary.extend({ memberId: z.uuid() }),
  // Every member's level, because a person's own level in this workspace says nothing
  // about starting another: the handler's rules are the whole of what authorises it.
  access: ACCESS_LEVELS.edit,
  safety: "write" as const,
  runsThroughPipeline: true,
  async handler(
    context: {
      pool: import("pg").Pool;
      actor: { readonly kind: string; readonly userId?: string };
    },
    rawInput: unknown,
  ): Promise<{
    workspaceId: string;
    memberId: string;
    name: string;
    slug: string;
  }> {
    const input = provisionWorkspace.input.parse(rawInput);
    const options = {
      ...(input.name ? { name: input.name } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
    };

    // **A signed-in person may start one where sign-up is open to them**
    // (docs/design/hosting-profiles.md §3), and only for themselves. No member
    // of any workspace may create one for somebody else, whatever their level.
    if (context.actor.kind === "human" && context.actor.userId) {
      if (input.user && input.user.id !== context.actor.userId) {
        throw new OperationError(
          "forbidden",
          "A workspace cannot be created for somebody else here.",
        );
      }
      return createOwnWorkspace(context.pool, {
        userId: context.actor.userId,
        ...options,
      });
    }

    // Registration and the setup wizard call `createWorkspace` directly, so
    // this is the surfaces: nobody else reaches it, and an agent never does.
    if (
      (context.actor.kind !== "system" && context.actor.kind !== "operator") ||
      !input.user
    ) {
      throw new OperationError(
        "forbidden",
        "A workspace is created when somebody signs up, not through this action.",
      );
    }
    return createWorkspace(context.pool, { user: input.user, ...options });
  },
};

export const setWorkspaceLifecycle = defineWriteAction({
  name: "workspace.setLifecycle",
  summary: "Move a cloud workspace between active, suspended and closed.",
  input: z.object({
    state: z.enum(["active", "suspended", "closed"]),
  }),
  output: workspaceSummary.extend({
    state: z.enum(["active", "suspended", "closed"]),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    // On the freeze overlay's recovery list by prefix, like
    // `workspace.setState`: the write that lifts a suspension has to survive
    // the suspension. Closing is on the same list, and that is deliberate,
    // because a closed workspace being reopened is the same kind of write.
    async load({ tx, workspaceId }) {
      const [current] = await tx
        .select({ name: workspaces.name, slug: workspaces.slug })
        .from(workspaces)
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .limit(1);
      if (!current) {
        throw new OperationError("not_found", "No such workspace.");
      }
      return current;
    },
    async execute({ tx, workspaceId, loaded }) {
      // The tenancy module owns every read and write of `tenants`, and
      // `pnpm check:boundaries` is what keeps it that way. This action never
      // sees the table.
      const moved = await setTenantStateInTx(tx, {
        workspaceId,
        state: input.state,
      });
      if (!moved) {
        // No tenant row, which is every self-hosted instance. Refused rather
        // than silently doing half the work: on a self-hosted instance
        // `workspace.setState` is the whole of what freezing means, and a
        // caller who reached here wanted something this deployment does not
        // have.
        throw new OperationError(
          "not_found",
          "This workspace has no tenant record, so it has no lifecycle to move.",
        );
      }

      return {
        result: {
          workspaceId,
          name: loaded.name,
          slug: loaded.slug,
          state: input.state,
        },
        activity: {
          kind: "workspace.lifecycle_changed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { state: input.state },
        },
        audit: {
          action: "workspace.setLifecycle",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { state: input.state },
        },
      };
    },
  }),
});

/**
 * Moving a workspace onto another plan, declared so that an operator's change
 * resolves back to a contract like every other audit row.
 *
 * **An administrator could move their own workspace onto any plan, and nothing
 * asked them to pay.** REST, the command line and the agent tools all reached it
 * as well as S-49, so hiding the control would not have closed it, and so the
 * refusal is here. A plan changes through billing, or through
 * `setPlanAsOperator`, which is what a contract no card pays for needs.
 */
export const changeWorkspacePlan = {
  name: "workspace.changePlan" as const,
  agentSurface: false as const,
  summary:
    "Refused for a workspace's own members. A plan changes through billing, or through the instance's operator.",
  input: z.object({
    /** A key from the operator's catalogue, or null for the free tier. */
    planKey: z.string().trim().min(1).max(50).nullable(),
  }),
  output: z.object({
    planKey: z.string().nullable(),
    seats: z.number().int().nullable(),
  }),
  access: ACCESS_LEVELS.full,
  safety: "write" as const,
  runsThroughPipeline: true,
  async handler(): Promise<{ planKey: string | null; seats: number | null }> {
    throw new OperationError(
      "forbidden",
      "A workspace's plan changes through billing, or through whoever runs this instance.",
    );
  },
};
