/**
 * The bring-your-own-key precedence resolver (AI-NATIVE-PLAN.md §3.3,
 * P2-T14): "user key, then workspace configuration, then deployment
 * environment, then off," for one specific provider a call already knows it
 * needs (which tier maps to which provider is P2-T15's own job, not this
 * one's).
 *
 * Returns plain data, never a configured `AIProvider` instance:
 * `packages/core` may not depend on `packages/adapters` (TECHNICAL-PLAN §1),
 * so the host (`apps/web`, or an agent runtime) is the one that takes this
 * result and calls `createAIProvider` from the adapters package. This
 * mirrors `resolveMailSettings`'s own reasoning exactly.
 *
 * Deliberately a plain export, not a registered action: a decrypted key must
 * never reach a surface the action registry projects onto REST, MCP, the
 * command line or chat commands. The only supported callers are server-side
 * code already trusted to make the provider call itself — the same shape as
 * `resolveOwnWorkspaceAccessLevel` in `access/reads.ts`.
 */
import {
  type AIProviderKind,
  activeOnly,
  aiCredentials,
  aiProviders,
  withWorkspace,
} from "@openokr/db";
import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  environmentValue,
  getInstanceSetting,
  type InstanceSettingDefinition,
} from "../secrets/instance-registry.ts";
import {
  readSecret,
  readSettingRows,
  resolveSetting,
} from "../secrets/instance-settings.ts";
import {
  decryptSecret,
  type KeyRing,
  type SealedSecret,
} from "../secrets/key-ring.ts";

export type AICredentialSource = "user" | "workspace" | "deployment" | "off";

export type ResolvedAICredential =
  | {
      readonly source: "off";
    }
  | {
      readonly source: Exclude<AICredentialSource, "off">;
      readonly provider: AIProviderKind;
      readonly apiKey: string;
      readonly baseUrl: string | null;
    };

export interface ResolveAICredentialInput {
  readonly workspaceId: string;
  readonly provider: AIProviderKind;
  /** Omit for a workspace-only resolution (an agent run, a background job). */
  readonly memberId?: string;
}

const definition = (key: string): InstanceSettingDefinition => {
  const found = getInstanceSetting(key);
  if (!found) {
    throw new Error(`The instance settings registry has no entry for ${key}.`);
  }
  return found;
};

export interface ResolvedDeploymentAI {
  /** Empty means no deployment default is configured. */
  readonly provider: string;
  readonly apiKey: string;
  readonly baseUrl: string;
}

/** The deployment-wide fallback, resolved the same way `resolveMailSettings`
 * resolves the instance's mail configuration: stored row, then environment
 * bootstrap, then the registry's own empty default. */
export async function resolveDeploymentAISettings(
  pool: Pool,
  ring: KeyRing,
  environment: Record<string, string | undefined>,
): Promise<ResolvedDeploymentAI> {
  const rows = await readSettingRows(pool);

  const resolve = (key: string): string => {
    const setting = definition(key);
    const stored = rows.get(key)?.value ?? undefined;
    return resolveSetting<string>(
      stored,
      environmentValue(setting, environment) as string | undefined,
      setting.fallback as string,
    ).value;
  };

  const provider = resolve("ai.deployment.provider");
  const baseUrl = resolve("ai.deployment.baseUrl");
  const storedApiKey = await readSecret(pool, ring, "ai.deployment.apiKey");
  const apiKey =
    storedApiKey ??
    (environmentValue(definition("ai.deployment.apiKey"), environment) as
      | string
      | undefined) ??
    "";

  return { provider, apiKey, baseUrl };
}

const sealedFrom = (row: {
  ciphertext: string;
  dataKey: string;
  keyId: string;
}): SealedSecret => ({
  ciphertext: row.ciphertext,
  dataKey: row.dataKey,
  keyId: row.keyId,
});

/** One credential row for a provider, scoped to either the workspace
 * (`ownerMemberId: null`) or one member. Joined against `ai_providers` for
 * `base_url`/`enabled`/`allow_user_keys`, which every caller of this needs
 * alongside the key itself. */
async function findCredential(
  pool: Pool,
  workspaceId: string,
  provider: AIProviderKind,
  ownerMemberId: string | null,
) {
  const db = drizzle(pool);
  return withWorkspace(db, workspaceId, async (tx) => {
    const [providerRow] = await tx
      .select()
      .from(aiProviders)
      .where(
        activeOnly(
          aiProviders,
          eq(aiProviders.workspaceId, workspaceId),
          eq(aiProviders.provider, provider),
        ),
      )
      .limit(1);
    if (!providerRow) {
      return undefined;
    }

    const [credentialRow] = await tx
      .select()
      .from(aiCredentials)
      .where(
        activeOnly(
          aiCredentials,
          eq(aiCredentials.workspaceId, workspaceId),
          eq(aiCredentials.provider, provider),
          ownerMemberId === null
            ? isNull(aiCredentials.ownerMemberId)
            : eq(aiCredentials.ownerMemberId, ownerMemberId),
        ),
      )
      .limit(1);
    if (!credentialRow) {
      return undefined;
    }

    return { providerRow, credentialRow };
  });
}

/**
 * Resolves the credential a call for this exact provider should use, at
 * this precedence: the caller's own personal key (only when the provider
 * allows one), the workspace's own key, the deployment's own default (only
 * when it names this same provider), or off.
 */
export async function resolveAICredential(
  pool: Pool,
  ring: KeyRing,
  environment: Record<string, string | undefined>,
  input: ResolveAICredentialInput,
): Promise<ResolvedAICredential> {
  if (input.memberId) {
    const personal = await findCredential(
      pool,
      input.workspaceId,
      input.provider,
      input.memberId,
    );
    if (personal?.providerRow.allowUserKeys) {
      return {
        source: "user",
        provider: input.provider,
        apiKey: decryptSecret(ring, sealedFrom(personal.credentialRow)),
        baseUrl: personal.providerRow.baseUrl,
      };
    }
  }

  const workspace = await findCredential(
    pool,
    input.workspaceId,
    input.provider,
    null,
  );
  if (workspace?.providerRow.enabled) {
    return {
      source: "workspace",
      provider: input.provider,
      apiKey: decryptSecret(ring, sealedFrom(workspace.credentialRow)),
      baseUrl: workspace.providerRow.baseUrl,
    };
  }

  const deployment = await resolveDeploymentAISettings(pool, ring, environment);
  if (deployment.provider === input.provider && deployment.apiKey !== "") {
    return {
      source: "deployment",
      provider: input.provider,
      apiKey: deployment.apiKey,
      baseUrl: deployment.baseUrl === "" ? null : deployment.baseUrl,
    };
  }

  return { source: "off" };
}
