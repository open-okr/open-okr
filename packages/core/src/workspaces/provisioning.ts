/**
 * Workspace provisioning (TECHNICAL-PLAN §4.1, §4.14).
 *
 * The acceptance criterion for P1-T06, in one sentence: the first person to
 * register lands in a complete, working workspace without answering a single
 * question. Everything that makes that true happens in the one transaction
 * below, so there is no state where a workspace exists without its first
 * member, or a member without their settings.
 *
 * **Shaped for the Operation pipeline.** P1-T07 turns this into an Operation:
 * authorise against freshly loaded rows, then one transaction covering the
 * change, the access bindings, the activity row, the audit row and the outbox
 * row. The transaction here is that transaction, minus the parts whose tables
 * do not exist yet. When those land it gains statements rather than changing
 * shape.
 *
 * P2-T01 closes the last gap: the workspace gets its own access context and
 * `workspace_standard` group, and the first member gets a `member` group of
 * their own with a `full` binding on that context. `can()`, which actually
 * reads any of this, is P2-T02; until then `resolveActor` still resolves
 * every active member to `full` by construction.
 *
 * P3-T01 adds the default space, named after the workspace with the first
 * member as its manager (§4.14). Existing workspaces get theirs from the
 * `0003_backfill_default_space` data-change script rather than from a check on
 * every read.
 */
import {
  activeOnly,
  newId,
  withUser,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
  ensureWorkspaceStandardGroup,
} from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  ensureCurrentCycleInTx,
  ensureRhythmSettingsInTx,
} from "../cycles/service.ts";
import { runOperation } from "../operations/operation.ts";
import {
  type ProvisioningContext,
  resolveMemberSettings,
  resolveWorkspaceSettings,
} from "../settings/registry.ts";
import { resolveInstanceDefaultLanguage } from "../settings/workspace-defaults.ts";
import { createSpaceInTx } from "../spaces/service.ts";

export interface WorkspaceUser {
  readonly id: string;
  readonly name: string;
}

export interface CreateWorkspaceInput {
  readonly user: WorkspaceUser;
  /** Defaults to a name built from the person's own. */
  readonly name?: string;
  /** The registering browser's timezone. Validated by the settings registry. */
  readonly timezone?: string;
  /** Defaults to the instance's own resolved default language. */
  readonly language?: string;
}

export interface ProvisionedWorkspace {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly name: string;
  readonly slug: string;
}

/** How many times a slug collision is retried before giving up. */
const SLUG_ATTEMPTS = 6;

/**
 * A URL-safe slug from a workspace name.
 *
 * Non-Latin names are the interesting case: stripping accents and punctuation
 * can leave nothing at all, and an empty slug is not a usable address. Those
 * fall back to a generic stem, which the collision loop then makes unique.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    // Drop combining accents, so "Zoë" becomes "zoe" rather than "zo".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Apostrophes disappear rather than separate: "Ada's" is one word, so
    // "adas", not "ada-s".
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug === "" ? "workspace" : slug;
}

/** The default workspace name: the person's own, editable immediately. */
export function defaultWorkspaceName(userName: string): string {
  const trimmed = userName.trim();
  const name = trimmed === "" ? "My" : trimmed;
  return name.endsWith("s") ? `${name}' workspace` : `${name}'s workspace`;
}

/** Postgres unique-violation, anywhere in the error chain Drizzle wraps. */
const isUniqueViolation = (error: unknown): boolean => {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ((current as { code?: string }).code === "23505") {
      return true;
    }
  }
  return false;
};

const randomSuffix = (): string =>
  Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");

/**
 * Creates a workspace with this person as its first member.
 *
 * Not idempotent: calling it twice makes two workspaces, which is what joining
 * a second workspace means. `provisionWorkspaceForUser` is the idempotent
 * bootstrap built on top of it.
 */
export async function createWorkspace(
  pool: Pool,
  input: CreateWorkspaceInput,
): Promise<ProvisionedWorkspace> {
  const workspaceId = newId();
  // The instance's own resolved default, so a fresh workspace's language
  // sees `OPENOKR_DEFAULT_LANGUAGE` and an administered override the same
  // way every other instance setting does, rather than the registry's
  // hardcoded constant of last resort. Only asked for when the caller has no
  // language of its own to offer.
  const language =
    input.language ?? (await resolveInstanceDefaultLanguage(pool));

  // A bootstrap operation: it creates the workspace it runs in, so there is no
  // member to authorise against and no workspace to load. Everything else is
  // the ordinary pipeline, including the audit row, which is why the first
  // entry in every workspace's chain is its own creation.
  //
  // The tenant floor still applies to the row that creates the tenant. The id
  // is generated here and applied as the workspace setting before the insert,
  // so the policy's `with check` passes on a workspace that does not exist
  // yet. Nothing is exempted and no policy is loosened to make this work.
  return runOperation(
    { pool },
    {
      action: "workspace.provision",
      workspaceId,
      actor: { kind: "system" },
      bootstrap: true,
      async execute({ tx }) {
        const provisioned = await insertWorkspaceAndMember(tx, workspaceId, {
          ...input,
          language,
        });
        return {
          result: provisioned,
          activity: {
            kind: "workspace.provisioned",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { name: provisioned.name, slug: provisioned.slug },
          },
          audit: {
            action: "workspace.provision",
            targetType: "workspace",
            targetId: workspaceId,
            // The acting member does not exist yet, so the user this workspace
            // was created for is recorded here instead.
            payload: {
              userId: input.user.id,
              name: provisioned.name,
              slug: provisioned.slug,
              memberId: provisioned.memberId,
            },
          },
        };
      },
    },
  );
}

/**
 * Ensures this person has a workspace, and returns it.
 *
 * Idempotent, and safe to call concurrently. Better Auth runs after-create
 * hooks once its own transaction has already committed, so a failure during
 * provisioning leaves a real user with no workspace. This is both the hook and
 * the repair for that state, which is why it checks before it creates.
 */
export async function provisionWorkspaceForUser(
  pool: Pool,
  user: WorkspaceUser,
  context: ProvisioningContext = {},
): Promise<ProvisionedWorkspace> {
  // Creating the workspace is an Operation with its own transaction, so the
  // "have they got one already" check cannot share that transaction. A
  // session-level lock on a dedicated connection covers both instead: two
  // browser tabs finishing sign-up together would otherwise both find no
  // membership and both create a workspace.
  const guard = await pool.connect();
  try {
    await guard.query("select pg_advisory_lock(hashtext($1))", [
      `provision:${user.id}`,
    ]);

    const existing = await findMembership(pool, user.id);
    if (existing) {
      return existing;
    }

    return await createWorkspace(pool, { user, ...context });
  } finally {
    // Releasing before the connection returns to the pool matters: a
    // session-level lock outlives the transaction and would otherwise travel
    // with the connection to whoever gets it next.
    await guard
      .query("select pg_advisory_unlock(hashtext($1))", [
        `provision:${user.id}`,
      ])
      .catch(() => undefined);
    guard.release();
  }
}

/** This person's first live membership, or nothing. */
async function findMembership(
  pool: Pool,
  userId: string,
): Promise<ProvisionedWorkspace | undefined> {
  const db = drizzle(pool);
  const [existing] = await withUser(db, userId, (tx) =>
    tx
      .select({
        workspaceId: workspaces.id,
        memberId: workspaceMembers.id,
        name: workspaces.name,
        slug: workspaces.slug,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          activeOnly(workspaceMembers, eq(workspaceMembers.userId, userId)),
          activeOnly(workspaces),
        ),
      )
      .limit(1),
  );
  return existing;
}

type Tx = Parameters<
  Parameters<ReturnType<typeof drizzle>["transaction"]>[0]
>[0];

/**
 * The workspace, its first member and every default, written together.
 *
 * The slug has to be unique across the instance, and row-level security means
 * this transaction cannot see whether another workspace already holds the one
 * it wants. So it does not look: it writes, and lets the unique index answer.
 * Each attempt runs in a savepoint, because a violation would otherwise poison
 * the surrounding transaction.
 */
async function insertWorkspaceAndMember(
  tx: Tx,
  workspaceId: string,
  input: CreateWorkspaceInput & ProvisioningContext,
): Promise<ProvisionedWorkspace> {
  const name = input.name?.trim() || defaultWorkspaceName(input.user.name);
  const base = slugify(name);
  const settings = resolveWorkspaceSettings(input);
  const memberSettings = resolveMemberSettings(input);
  const memberId = newId();

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    try {
      return await tx.transaction(async (savepoint) => {
        // openokr:allow-mutation: this helper is called from the provisioning
        // operation at the top of this file and writes on the transaction that
        // operation opened, so the audit and activity rows commit with it. The
        // write is lexically outside the runOperation call, which is what the
        // marker records.
        await savepoint
          .insert(workspaces)
          .values({ id: workspaceId, name, slug, settings });

        // openokr:allow-mutation: the same transaction, and the same reason.
        // The first member is written beside the workspace or not at all.
        await savepoint.insert(workspaceMembers).values({
          id: memberId,
          workspaceId,
          userId: input.user.id,
          name: input.user.name,
          // The member's own timezone starts as the workspace's. A person in
          // another country changes it in their profile (P2-T03).
          timezone: settings.timezone,
          kind: "human",
          status: "active",
          primaryChannel:
            memberSettings.primaryChannel as typeof workspaceMembers.$inferInsert.primaryChannel,
          quietHours: memberSettings.quietHours,
        });

        // The workspace is the first protected aggregate this workspace
        // owns: its own access context, plus the standing groups an Operation
        // wires up for any later aggregate. openokr:allow-mutation: same
        // reason as the two inserts above, same transaction.
        const contextId = await ensureContext(savepoint, {
          workspaceId,
          resourceType: "workspace",
          resourceId: workspaceId,
        });
        // Every active member belongs to this group "by definition" (reads.ts's
        // own words), but that is only true in practice once it actually holds
        // a binding: without one, `resolveMemberAccessLevel` has nothing to
        // find for anyone who is not the founding member, and an ordinary
        // invited member resolves to zero on the workspace's own context —
        // unable to read the overview or edit their own profile. `edit` is
        // the ceiling: it covers self-service and reading the workspace
        // aggregate, and stays below every `full`-gated admin action
        // (settings, invitations, member lifecycle, rename).
        const workspaceStandardGroupId = await ensureWorkspaceStandardGroup(
          savepoint,
          { workspaceId },
        );
        await bindGroup(savepoint, {
          workspaceId,
          groupId: workspaceStandardGroupId,
          contextId,
          level: ACCESS_LEVELS.edit,
        });
        const memberGroupId = await ensureMemberGroup(savepoint, {
          workspaceId,
          memberId,
        });
        await bindGroup(savepoint, {
          workspaceId,
          groupId: memberGroupId,
          contextId,
          level: ACCESS_LEVELS.full,
        });

        // TECHNICAL-PLAN §4.14: "One space named after the workspace, with the
        // first member as its manager, who covers the coordinator's duties
        // until one is named." Named after the workspace rather than something
        // generic, and created here rather than offered as a choice, because no
        // screen may block until a setting is chosen. There is deliberately no
        // `defaultSpaceName` setting: §4.14 already answers the question, and a
        // setting would be a second answer to it.
        await createSpaceInTx(savepoint, {
          workspaceId,
          name,
          managerMemberId: memberId,
        });

        // The rhythm and the first cycle (P3-T02). §4.14's hard rule is that a
        // fresh workspace practises the full method with nothing configured, and
        // a planning tool with no time box to plan in does not. Every column on
        // `rhythm_settings` defaults to the §11 canon, so the row is the canon.
        await ensureRhythmSettingsInTx(savepoint, workspaceId);
        await ensureCurrentCycleInTx(savepoint, {
          workspaceId,
          timeZone: settings.timezone as string,
          now: new Date(),
        });

        return { workspaceId, memberId, name, slug };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  throw new Error(
    `Could not find a free slug for "${name}" after ${SLUG_ATTEMPTS} attempts.`,
  );
}
