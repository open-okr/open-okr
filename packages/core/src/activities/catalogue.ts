/**
 * The typed activity catalogue (TECHNICAL-PLAN §4.11, P2-T07).
 *
 * "Payloads snapshot human labels": a feed entry has to read like a
 * sentence without a second query, and it has to keep reading that way
 * after the thing it names is renamed, converted or erased. Every kind
 * below that can outlive its own display name carries that name in its
 * payload rather than trusting a live lookup.
 *
 * `test.*` kinds are exempt from the "unregistered kind cannot be
 * persisted" rule. Every prior Phase 2 task's tests write throwaway
 * activity kinds (`test.bind`, `test.grant-full`, and so on) as scaffolding
 * for exercising the Operation pipeline, not as product events; retrofitting
 * every one of them into this catalogue would make the catalogue describe
 * test fixtures instead of the product. A kind in this shape can never be a
 * real one: `workspace.provisioned` and `test.bind` cannot collide.
 */
import { z } from "zod";

const TEST_SCAFFOLD_KIND = /^test\./;

export const isTestScaffoldKind = (kind: string): boolean =>
  TEST_SCAFFOLD_KIND.test(kind);

/**
 * One entry per registered kind, its payload schema. `z.object({})` where a
 * kind has nothing worth snapshotting yet — an id in `subjectId` is already
 * enough to look the current row up, and nothing about it changes shape the
 * way a member's name does.
 */
export const ACTIVITY_PAYLOAD_SCHEMAS = {
  "workspace.provisioned": z.object({ name: z.string(), slug: z.string() }),
  "workspace.renamed": z.object({ from: z.string(), to: z.string() }),
  "workspace.state_changed": z.object({
    from: z.enum(["active", "read_only", "frozen"]),
    to: z.enum(["active", "read_only", "frozen"]),
  }),
  "member.profile_updated": z.object({ name: z.string() }),
  "member.updated": z.object({ name: z.string() }),
  "member.suspended": z.object({ name: z.string() }),
  "member.restored": z.object({ name: z.string() }),
  "member.converted_to_guest": z.object({ name: z.string() }),
  "member.erased": z.object({ name: z.string() }),
  "invitation.link_created": z.object({}).catchall(z.unknown()),
  "invitation.link_revoked": z.object({}),
  "invitation.accepted": z.object({}).catchall(z.unknown()),
  "invitation.joined_by_trusted_domain": z.object({}).catchall(z.unknown()),
  "blob.prepared": z.object({}),
  "blob.claimed": z.object({}).catchall(z.unknown()),
  "notification.read": z.object({}),
  "notification.snoozed": z.object({}),
  "notification_settings.updated": z.object({}),
  "subscription.added": z.object({}),
  "subscription.canceled": z.object({}),
  "workspace.general_settings_updated": z
    .object({ keys: z.array(z.string()) })
    .catchall(z.unknown()),
  "workspace.branding_updated": z.object({}).catchall(z.unknown()),
  "workspace.settings_reset": z
    .object({ keys: z.array(z.string()) })
    .catchall(z.unknown()),
  "ai.provider_config_updated": z.object({ provider: z.string() }),
  "ai.workspace_credential_set": z.object({ provider: z.string() }),
  "ai.workspace_credential_removed": z.object({ provider: z.string() }),
  "ai.personal_credential_set": z.object({ provider: z.string() }),
  "ai.personal_credential_removed": z.object({ provider: z.string() }),
  "ai.credentials_rotated": z.object({
    examined: z.number().int(),
    rewrapped: z.number().int(),
  }),
} as const satisfies Record<string, z.ZodType>;

export type ActivityKind = keyof typeof ACTIVITY_PAYLOAD_SCHEMAS;

/**
 * The kinds a feed renderer collapses consecutive same-actor rows into one
 * entry for: an edit to something, restated five times in five minutes, is
 * one story. Every other kind is a narrative event — a status changed, a
 * relationship formed — and is never collapsed, even next to an identical
 * one, because "suspended, then restored, then suspended again" is not the
 * same event three times.
 */
export const AGGREGATABLE_KINDS: ReadonlySet<string> = new Set([
  "member.profile_updated",
  "member.updated",
  "workspace.general_settings_updated",
  "workspace.branding_updated",
]);

export class UnregisteredActivityKindError extends Error {
  constructor(kind: string) {
    super(
      `"${kind}" is not in the activity catalogue ` +
        `(packages/core/src/activities/catalogue.ts). Register it there, ` +
        `with a payload schema, before an operation can persist it.`,
    );
    this.name = "UnregisteredActivityKindError";
  }
}

export class InvalidActivityPayloadError extends Error {
  constructor(kind: string, issues: string) {
    super(`Activity "${kind}" has an invalid payload: ${issues}`);
    this.name = "InvalidActivityPayloadError";
  }
}

/**
 * Throws for a kind outside the catalogue, or a payload that does not match
 * its own kind's schema — "an event kind outside the catalogue cannot be
 * persisted" as a build-time check would only catch a typo written today;
 * this catches one written by whoever adds the nineteenth kind next year.
 */
export function validateActivityPayload(
  kind: string,
  payload: Record<string, unknown>,
): void {
  if (isTestScaffoldKind(kind)) {
    return;
  }
  const schema = (
    ACTIVITY_PAYLOAD_SCHEMAS as Record<string, z.ZodType | undefined>
  )[kind];
  if (!schema) {
    throw new UnregisteredActivityKindError(kind);
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new InvalidActivityPayloadError(kind, result.error.message);
  }
}
