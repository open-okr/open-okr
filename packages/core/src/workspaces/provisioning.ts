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
 * shape. Deliberately missing until then, and recorded on the P1-T07 row:
 *
 *   - the audit row, because the append-only audit table is P1-T07
 *   - the outbox row, because provisioning has no side effect to enqueue yet
 *   - the first member's access binding, because bindings are P2-T01
 */
import {
  activeOnly,
  newId,
  withContext,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  type ProvisioningContext,
  resolveMemberSettings,
  resolveWorkspaceSettings,
} from "../settings/registry.ts";

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
  const db = drizzle(pool);
  const workspaceId = newId();

  // The tenant floor applies to the row that creates the tenant. The id is
  // generated here and applied as the workspace setting before the insert, so
  // the policy's `with check` passes on a workspace that does not exist yet.
  // Nothing is exempted and no policy is loosened to make this work.
  return withContext(db, { workspaceId }, (tx) =>
    insertWorkspaceAndMember(tx, workspaceId, input),
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
  const db = drizzle(pool);
  const workspaceId = newId();

  // Both settings, in one transaction: the user setting to see whether this
  // person is already a member somewhere, the workspace setting to create the
  // new one if they are not.
  return withContext(db, { workspaceId, userId: user.id }, async (tx) => {
    // Serialises concurrent provisions of the same person. Two browser tabs
    // finishing sign-up together would otherwise both find no membership and
    // both create a workspace. The lock is transaction-scoped, so it is
    // released by the commit or the rollback either way.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`provision:${user.id}`}))`,
    );

    const [existing] = await tx
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
          activeOnly(workspaceMembers, eq(workspaceMembers.userId, user.id)),
          activeOnly(workspaces),
        ),
      )
      .limit(1);

    if (existing) {
      return existing;
    }

    return insertWorkspaceAndMember(tx, workspaceId, { user, ...context });
  });
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
        await savepoint
          .insert(workspaces)
          .values({ id: workspaceId, name, slug, settings });

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
