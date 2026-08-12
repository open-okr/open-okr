/**
 * AI provider configuration and credential actions (AI-NATIVE-PLAN.md §3.3,
 * §4, §7, P2-T14).
 *
 * Three admin actions (`updateProviderConfig`, `setWorkspaceCredential`,
 * `removeWorkspaceCredential`) require `full`, matching every other S-36/S-37
 * admin card. Two self-service actions (`setPersonalCredential`,
 * `removePersonalCredential`) require only `edit` — the level every active
 * member now holds through `workspace_standard` — and additionally check the
 * provider's own `allowUserKeys` flag, since a workspace admin decides
 * whether personal keys are offered at all before any member can add one.
 *
 * Nothing here ever returns a decrypted key. `readProviderConfig` and
 * `readOwnCredentialStatus` hand back only a masked hint and a status, the
 * same shape AI-NATIVE-PLAN §3.3 asks for ("a masked hint and a live
 * connection test"). Decryption happens only inside
 * `packages/core/src/ai/resolve.ts`, called directly by a host-side caller
 * already trusted to make the real provider call — never through this
 * registry, which is what REST, MCP, the command line and chat commands all
 * eventually project onto identically.
 *
 * **Rotation is per-workspace, not a second instance-wide sweep.**
 * `pnpm keys:rotate` (`packages/core/src/secrets/rotate.ts`) re-wraps every
 * `system_settings` secret because that table sits above the tenant floor,
 * the same way `instance_audit_events` does, with its own `app.
 * instance_admin` policy exception. `ai_credentials` is ordinary workspace
 * data with `FORCE ROW LEVEL SECURITY` and no such exception, by design —
 * extending the instance-admin bypass to reach workspace data would be
 * exactly the "row-level security is the tenant floor, not replaced" hard
 * rule this task should not quietly cross for its own convenience. So
 * `rotateCredentials` below re-wraps one workspace's own rows, inside that
 * workspace's own `getAccessScoped`-gated transaction, the same way every
 * other write here already works — "one command" from a workspace admin's
 * own seat, not a second global sweep alongside the instance one.
 */
import {
  AI_PROVIDER_KINDS,
  activeOnly,
  aiCredentials,
  aiProviders,
  type WorkspaceTx,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { maskKeyHint, sealCredentialKey } from "../ai/credentials.ts";
import { OperationError } from "../operations/operation.ts";
import { type KeyRing, rewrapSecret } from "../secrets/key-ring.ts";
import {
  type ActionCallContext,
  defineReadAction,
  defineWriteAction,
} from "./define.ts";

const providerSchema = z.enum(AI_PROVIDER_KINDS);

function requireRing(context: ActionCallContext): KeyRing {
  if (!context.ring) {
    throw new Error(
      "This host built an ActionCallContext with no key ring, but reached " +
        "an action that needs one to seal or open a credential.",
    );
  }
  return context.ring;
}

const providerConfigOutput = z.object({
  provider: providerSchema,
  baseUrl: z.string().nullable(),
  enabled: z.boolean(),
  allowUserKeys: z.boolean(),
  hasWorkspaceCredential: z.boolean(),
  workspaceKeyHint: z.string().nullable(),
  workspaceKeyStatus: z.enum(["unverified", "verified", "invalid"]).nullable(),
});

export const readProviderConfig = defineReadAction({
  name: "ai.readProviderConfig",
  summary:
    "Every provider's admin configuration, with a masked hint for its workspace key.",
  input: z.object({}),
  output: z.array(providerConfigOutput),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const providers = await tx
        .select()
        .from(aiProviders)
        .where(
          activeOnly(
            aiProviders,
            eq(aiProviders.workspaceId, context.workspaceId),
          ),
        );

      const credentials = await tx
        .select()
        .from(aiCredentials)
        .where(
          activeOnly(
            aiCredentials,
            eq(aiCredentials.workspaceId, context.workspaceId),
            isNull(aiCredentials.ownerMemberId),
          ),
        );
      const credentialByProvider = new Map(
        credentials.map((row) => [row.provider, row]),
      );

      return providers.map((provider) => {
        const credential = credentialByProvider.get(provider.provider);
        return {
          provider: provider.provider,
          baseUrl: provider.baseUrl,
          enabled: provider.enabled,
          allowUserKeys: provider.allowUserKeys,
          hasWorkspaceCredential: credential !== undefined,
          workspaceKeyHint: credential?.keyHint ?? null,
          workspaceKeyStatus: credential?.status ?? null,
        };
      });
    });
  },
});

export const updateProviderConfig = defineWriteAction({
  name: "ai.updateProviderConfig",
  summary:
    "Turns a provider on or off for this workspace, and whether members may add a personal key for it.",
  input: z.object({
    provider: providerSchema,
    enabled: z.boolean().optional(),
    allowUserKeys: z.boolean().optional(),
    baseUrl: z.string().trim().min(1).nullable().optional(),
  }),
  output: providerConfigOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [existing] = await tx
        .select()
        .from(aiProviders)
        .where(
          activeOnly(
            aiProviders,
            eq(aiProviders.workspaceId, workspaceId),
            eq(aiProviders.provider, input.provider),
          ),
        )
        .limit(1);
      return existing;
    },
    async execute({ tx, workspaceId, loaded }) {
      const row = {
        workspaceId,
        provider: input.provider,
        enabled: input.enabled ?? loaded?.enabled ?? false,
        allowUserKeys: input.allowUserKeys ?? loaded?.allowUserKeys ?? false,
        baseUrl:
          input.baseUrl === undefined
            ? (loaded?.baseUrl ?? null)
            : input.baseUrl,
        updatedAt: new Date(),
      };

      // Not an upsert: `ai_providers_workspace_provider_idx` is a partial
      // unique index (`where deleted_at is null`), which `ON CONFLICT`
      // cannot target directly without also repeating that predicate. `load`
      // above already found (or didn't find) the live row, so branching on
      // it plainly is simpler than teaching the insert about the partial
      // index.
      let updated: typeof aiProviders.$inferSelect | undefined;
      if (loaded) {
        // openokr:allow-mutation: this is the operation's own execute, on
        // the transaction runOperation opened. The change, the activity and
        // the audit row commit together.
        [updated] = await tx
          .update(aiProviders)
          .set(row)
          .where(activeOnly(aiProviders, eq(aiProviders.id, loaded.id)))
          .returning();
      } else {
        // openokr:allow-mutation: same reason as the update above.
        [updated] = await tx.insert(aiProviders).values(row).returning();
      }
      if (!updated) {
        throw new OperationError(
          "not_found",
          "Could not update the provider configuration.",
        );
      }

      return {
        result: {
          provider: updated.provider,
          baseUrl: updated.baseUrl,
          enabled: updated.enabled,
          allowUserKeys: updated.allowUserKeys,
          hasWorkspaceCredential: false,
          workspaceKeyHint: null,
          workspaceKeyStatus: null,
        },
        activity: {
          kind: "ai.provider_config_updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { provider: input.provider },
        },
        audit: {
          action: "ai.updateProviderConfig",
          targetType: "workspace",
          targetId: workspaceId,
          payload: {
            provider: input.provider,
            enabled: row.enabled,
            allowUserKeys: row.allowUserKeys,
          },
        },
      };
    },
  }),
});

const credentialStatusOutput = z.object({
  provider: providerSchema,
  keyHint: z.string(),
  status: z.enum(["unverified", "verified", "invalid"]),
});

async function upsertCredential(
  tx: WorkspaceTx,
  ring: KeyRing,
  input: {
    workspaceId: string;
    provider: (typeof AI_PROVIDER_KINDS)[number];
    ownerMemberId: string | null;
    apiKey: string;
  },
): Promise<{ keyHint: string; status: "unverified" }> {
  const sealed = sealCredentialKey(ring, input.apiKey);
  const keyHint = maskKeyHint(input.apiKey);
  const row = {
    workspaceId: input.workspaceId,
    provider: input.provider,
    ownerMemberId: input.ownerMemberId,
    ciphertext: sealed.ciphertext,
    dataKey: sealed.dataKey,
    keyId: sealed.keyId,
    keyHint,
    status: "unverified" as const,
    lastVerifiedAt: null,
    updatedAt: new Date(),
  };

  const existing = await tx
    .select({ id: aiCredentials.id })
    .from(aiCredentials)
    .where(
      activeOnly(
        aiCredentials,
        eq(aiCredentials.workspaceId, input.workspaceId),
        eq(aiCredentials.provider, input.provider),
        input.ownerMemberId === null
          ? isNull(aiCredentials.ownerMemberId)
          : eq(aiCredentials.ownerMemberId, input.ownerMemberId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    // openokr:allow-mutation: called only from inside this file's own
    // operation execute blocks below, on the transaction runOperation opened.
    await tx
      .update(aiCredentials)
      .set(row)
      .where(activeOnly(aiCredentials, eq(aiCredentials.id, existing[0].id)));
  } else {
    // openokr:allow-mutation: same reason as the update above.
    await tx.insert(aiCredentials).values(row);
  }

  return { keyHint, status: "unverified" };
}

export const setWorkspaceCredential = defineWriteAction({
  name: "ai.setWorkspaceCredential",
  summary: "Sets or replaces the workspace's own key for a provider.",
  input: z.object({
    provider: providerSchema,
    apiKey: z.string().trim().min(1),
  }),
  output: credentialStatusOutput,
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async load({ tx, workspaceId }) {
      const [provider] = await tx
        .select({ id: aiProviders.id })
        .from(aiProviders)
        .where(
          activeOnly(
            aiProviders,
            eq(aiProviders.workspaceId, workspaceId),
            eq(aiProviders.provider, input.provider),
          ),
        )
        .limit(1);
      if (!provider) {
        throw new OperationError(
          "not_found",
          `${input.provider} has no configuration yet. Turn it on first.`,
        );
      }
    },
    async execute({ tx, workspaceId }) {
      const ring = requireRing(context);
      const { keyHint, status } = await upsertCredential(tx, ring, {
        workspaceId,
        provider: input.provider,
        ownerMemberId: null,
        apiKey: input.apiKey,
      });

      return {
        result: { provider: input.provider, keyHint, status },
        activity: {
          kind: "ai.workspace_credential_set",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { provider: input.provider },
        },
        audit: {
          action: "ai.setWorkspaceCredential",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { provider: input.provider },
        },
      };
    },
  }),
});

export const removeWorkspaceCredential = defineWriteAction({
  name: "ai.removeWorkspaceCredential",
  summary: "Removes the workspace's own key for a provider.",
  input: z.object({ provider: providerSchema }),
  output: z.object({ provider: providerSchema }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [existing] = await tx
        .select({ id: aiCredentials.id })
        .from(aiCredentials)
        .where(
          activeOnly(
            aiCredentials,
            eq(aiCredentials.workspaceId, workspaceId),
            eq(aiCredentials.provider, input.provider),
            isNull(aiCredentials.ownerMemberId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError(
          "not_found",
          `No workspace key stored for ${input.provider}.`,
        );
      }
      // openokr:allow-mutation: this is the operation's own execute.
      await tx
        .update(aiCredentials)
        .set({ deletedAt: new Date() })
        .where(activeOnly(aiCredentials, eq(aiCredentials.id, existing.id)));

      return {
        result: { provider: input.provider },
        activity: {
          kind: "ai.workspace_credential_removed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { provider: input.provider },
        },
        audit: {
          action: "ai.removeWorkspaceCredential",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { provider: input.provider },
        },
      };
    },
  }),
});

export const setPersonalCredential = defineWriteAction({
  name: "ai.setPersonalCredential",
  summary: "Sets or replaces the signed-in member's own key for a provider.",
  input: z.object({
    provider: providerSchema,
    apiKey: z.string().trim().min(1),
  }),
  output: credentialStatusOutput,
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async load({ tx, workspaceId }) {
      const [provider] = await tx
        .select({ allowUserKeys: aiProviders.allowUserKeys })
        .from(aiProviders)
        .where(
          activeOnly(
            aiProviders,
            eq(aiProviders.workspaceId, workspaceId),
            eq(aiProviders.provider, input.provider),
          ),
        )
        .limit(1);
      if (!provider?.allowUserKeys) {
        throw new OperationError(
          "not_found",
          `${input.provider} does not accept a personal key in this workspace.`,
        );
      }
    },
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("not_found", "No such member.");
      }
      const ring = requireRing(context);
      const { keyHint, status } = await upsertCredential(tx, ring, {
        workspaceId,
        provider: input.provider,
        ownerMemberId: actor.memberId,
        apiKey: input.apiKey,
      });

      return {
        result: { provider: input.provider, keyHint, status },
        activity: {
          kind: "ai.personal_credential_set",
          subjectType: "workspace_member",
          subjectId: actor.memberId,
          payload: { provider: input.provider },
        },
        audit: {
          action: "ai.setPersonalCredential",
          targetType: "workspace_member",
          targetId: actor.memberId,
          payload: { provider: input.provider },
        },
      };
    },
  }),
});

export const removePersonalCredential = defineWriteAction({
  name: "ai.removePersonalCredential",
  summary: "Removes the signed-in member's own key for a provider.",
  input: z.object({ provider: providerSchema }),
  output: z.object({ provider: providerSchema }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("not_found", "No such member.");
      }
      const [existing] = await tx
        .select({ id: aiCredentials.id })
        .from(aiCredentials)
        .where(
          activeOnly(
            aiCredentials,
            eq(aiCredentials.workspaceId, workspaceId),
            eq(aiCredentials.provider, input.provider),
            eq(aiCredentials.ownerMemberId, actor.memberId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError(
          "not_found",
          `No personal key stored for ${input.provider}.`,
        );
      }
      // openokr:allow-mutation: this is the operation's own execute.
      await tx
        .update(aiCredentials)
        .set({ deletedAt: new Date() })
        .where(activeOnly(aiCredentials, eq(aiCredentials.id, existing.id)));

      return {
        result: { provider: input.provider },
        activity: {
          kind: "ai.personal_credential_removed",
          subjectType: "workspace_member",
          subjectId: actor.memberId,
          payload: { provider: input.provider },
        },
        audit: {
          action: "ai.removePersonalCredential",
          targetType: "workspace_member",
          targetId: actor.memberId,
          payload: { provider: input.provider },
        },
      };
    },
  }),
});

export const readOwnCredentialStatus = defineReadAction({
  name: "ai.readOwnCredentialStatus",
  summary:
    "Which providers accept a personal key, and whether the signed-in member has one.",
  input: z.object({}),
  output: z.array(
    z.object({
      provider: providerSchema,
      allowUserKeys: z.boolean(),
      hasPersonalCredential: z.boolean(),
      keyHint: z.string().nullable(),
      status: z.enum(["unverified", "verified", "invalid"]).nullable(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const userId = context.actor.userId;
      if (!userId) {
        return [];
      }
      const providers = await tx
        .select()
        .from(aiProviders)
        .where(
          activeOnly(
            aiProviders,
            eq(aiProviders.workspaceId, context.workspaceId),
            eq(aiProviders.allowUserKeys, true),
          ),
        );
      if (providers.length === 0) {
        return [];
      }

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
        return [];
      }
      const memberId = member.id;

      const credentials = await tx
        .select()
        .from(aiCredentials)
        .where(
          activeOnly(
            aiCredentials,
            eq(aiCredentials.workspaceId, context.workspaceId),
            eq(aiCredentials.ownerMemberId, memberId),
          ),
        );
      const credentialByProvider = new Map(
        credentials.map((row) => [row.provider, row]),
      );

      return providers.map((provider) => {
        const credential = credentialByProvider.get(provider.provider);
        return {
          provider: provider.provider,
          allowUserKeys: provider.allowUserKeys,
          hasPersonalCredential: credential !== undefined,
          keyHint: credential?.keyHint ?? null,
          status: credential?.status ?? null,
        };
      });
    });
  },
});

export const rotateCredentials = defineWriteAction({
  name: "ai.rotateCredentials",
  summary:
    "Re-wraps every credential this workspace stores onto the current root key.",
  input: z.object({}),
  output: z.object({ examined: z.number().int(), rewrapped: z.number().int() }),
  access: ACCESS_LEVELS.full,
  operation: (context, _input) => ({
    async load({ tx, workspaceId }) {
      return tx
        .select()
        .from(aiCredentials)
        .where(
          activeOnly(aiCredentials, eq(aiCredentials.workspaceId, workspaceId)),
        );
    },
    async execute({ tx, workspaceId, loaded }) {
      const ring = requireRing(context);
      let rewrapped = 0;

      for (const row of loaded) {
        const next = rewrapSecret(ring, {
          ciphertext: row.ciphertext,
          dataKey: row.dataKey,
          keyId: row.keyId,
        });
        if (next.keyId === row.keyId) {
          continue;
        }
        // openokr:allow-mutation: this is the operation's own execute, on
        // the transaction runOperation opened. Only the wrapping changes;
        // the credential's own ciphertext is copied across untouched, so a
        // rotation that stops partway leaves every credential readable.
        await tx
          .update(aiCredentials)
          .set({
            dataKey: next.dataKey,
            keyId: next.keyId,
            updatedAt: new Date(),
          })
          .where(activeOnly(aiCredentials, eq(aiCredentials.id, row.id)));
        rewrapped += 1;
      }

      return {
        result: { examined: loaded.length, rewrapped },
        activity: {
          kind: "ai.credentials_rotated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { examined: loaded.length, rewrapped },
        },
        audit: {
          action: "ai.rotateCredentials",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { examined: loaded.length, rewrapped },
        },
      };
    },
  }),
});
