/**
 * The AI egress controls a workspace has chosen, and the record of what they
 * did (AI-NATIVE-PLAN §4, completeness review M-10).
 *
 * The controls are enforced in `packages/adapters`, around every provider
 * `createAIProvider` builds, because that is the one place no caller can step
 * around. This is the other half: reading the four settings the host passes
 * in, and writing down each time one of them withheld or replaced something.
 *
 * Both are plain exports rather than registered actions, for the reason
 * `resolveAICredential` and `recordUsageEvent` are: the host that builds a
 * provider is already trusted to make the call, and a record of what a call
 * did is a fact only that host knows. The card reads and writes through
 * `ai.readPrivacySettings` and `ai.updatePrivacySettings`.
 */
import { withWorkspace } from "@openokr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { runOperation } from "../operations/operation.ts";
import {
  type AIContextEgressLevel,
  findWorkspaceSetting,
} from "../settings/registry.ts";

/** The four controls, resolved. The shape `createAIProvider` takes. */
export interface AIPrivacySettings {
  readonly contextEgress: AIContextEgressLevel;
  readonly redactPersonalData: boolean;
  readonly noTraining: boolean;
  readonly allowedHosts: readonly string[];
}

/** The registry key each control is stored under. */
export const AI_PRIVACY_KEYS = {
  contextEgress: "aiContextEgress",
  redactPersonalData: "aiRedactPersonalData",
  noTraining: "aiNoTraining",
  allowedHosts: "aiEgressAllowList",
} as const satisfies Record<keyof AIPrivacySettings, string>;

/**
 * One stored value, or the registry's default when it is absent or no longer
 * parses.
 *
 * A workspace provisioned before these settings existed has none of the keys,
 * and resolves to exactly what a new one is given. A value that fails its own
 * schema means the schema tightened after it was written; the default always
 * parses, and a setting that cannot be read has no business deciding what
 * leaves.
 */
function settingFrom<T>(
  stored: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
): T {
  const setting = findWorkspaceSetting(key);
  if (!setting) {
    throw new Error(`The settings registry has no workspace setting ${key}.`);
  }
  if (stored && Object.hasOwn(stored, key)) {
    const parsed = setting.schema.safeParse(stored[key]);
    if (parsed.success) {
      return parsed.data as T;
    }
  }
  return setting.resolve({}) as T;
}

/** The four controls from a workspace's stored settings map. */
export function aiPrivacyFrom(
  stored: Readonly<Record<string, unknown>> | null | undefined,
): AIPrivacySettings {
  return {
    contextEgress: settingFrom(stored, AI_PRIVACY_KEYS.contextEgress),
    redactPersonalData: settingFrom(stored, AI_PRIVACY_KEYS.redactPersonalData),
    noTraining: settingFrom(stored, AI_PRIVACY_KEYS.noTraining),
    allowedHosts: settingFrom(stored, AI_PRIVACY_KEYS.allowedHosts),
  };
}

/**
 * A workspace's controls, read inside its own tenant setting.
 *
 * Read per provider build rather than cached, for the reason provider keys
 * are: an administrator can tighten a control at three in the afternoon, and
 * the next call should obey it.
 */
export async function resolveAIPrivacySettings(
  pool: Pool,
  workspaceId: string,
): Promise<AIPrivacySettings> {
  const rows = await withWorkspace(drizzle(pool), workspaceId, async (tx) => {
    const result = await tx.execute<{ settings: Record<string, unknown> }>(sql`
      select settings
        from workspaces
       where id = ${workspaceId}
         and deleted_at is null`);
    return result.rows;
  });
  return aiPrivacyFrom(rows[0]?.settings);
}

export interface RecordAIEgressWithheldInput {
  readonly workspaceId: string;
  readonly provider: string;
  readonly host: string;
  readonly purpose: "assist" | "retrieval";
  readonly outcome: "refused" | "redacted";
  readonly reason?: "host_not_allowed" | "context_withheld";
  readonly emails: number;
  readonly phones: number;
}

/**
 * Writes down that a control acted on one request, and never what it held.
 *
 * An audit row, because "nothing leaves silently" is a claim an administrator
 * should be able to check afterwards, and the audit trail is the record that
 * is append-only and verifiable. The payload is a host, a purpose and counts:
 * the text that was withheld or replaced is not in it, and nothing here was
 * ever handed that text.
 */
export async function recordAIEgressWithheld(
  pool: Pool,
  input: RecordAIEgressWithheldInput,
): Promise<void> {
  await runOperation(
    { pool },
    {
      action: "ai.egress_withheld",
      workspaceId: input.workspaceId,
      actor: { kind: "system" },
      // Recording that a control acted is not an edit to anything a level is
      // needed on, and there is no member to resolve: the same reasoning
      // `recordUsageEvent` gives for its own bootstrap.
      bootstrap: true,
      async execute({ workspaceId }) {
        return {
          result: undefined,
          activity: {
            kind: "ai.egress_withheld",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { provider: input.provider, outcome: input.outcome },
          },
          audit: {
            action: "ai.egressWithheld",
            targetType: "workspace",
            targetId: workspaceId,
            payload: {
              provider: input.provider,
              host: input.host,
              purpose: input.purpose,
              outcome: input.outcome,
              ...(input.reason ? { reason: input.reason } : {}),
              emails: input.emails,
              phones: input.phones,
            },
          },
        };
      },
    },
  );
}
