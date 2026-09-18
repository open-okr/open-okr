/**
 * The SCIM Users resource, through the ordinary write path (P8-T08a).
 *
 * P8-T08 wrote `workspace_members` and `users` with raw SQL from the route
 * handler, so every provisioning left no audit row, no activity row and no
 * outbox row, and created accounts around Better Auth rather than through it.
 * It also exported only `GET` and `POST`, so nothing suspended a member the
 * directory had removed, which is the whole acceptance criterion.
 *
 * Everything here goes through the same three doors the product uses
 * everywhere else: Better Auth owns accounts, `provisionMemberForInvite` is
 * the one member funnel, and `people.suspend` and `people.restore` are the
 * one pair that changes a member's status.
 *
 * **Deactivation maps to suspension and never to deletion.** Suspension
 * already removes every access: `resolveMemberAccessLevel` and `resolveActor`
 * both exclude a member who is not active, so a suspended person's sessions,
 * tokens and grants stop working without anything being erased.
 */
import { withWorkspace } from "@openokr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { callAction } from "../actions/registry.ts";
import type { createAuth } from "../auth/auth.ts";
import { withProvisioningAuthority } from "../auth/provisioning-authority.ts";
import { joinWorkspaceForIdentity } from "../workspaces/directory-join.ts";

type Auth = ReturnType<typeof createAuth>;

export interface DirectoryDeps {
  readonly pool: Pool;
  /**
   * The Better Auth instance, injected by the app.
   *
   * Accounts are created through it rather than beside it, so a SCIM account
   * is the same shape as one born from a sign-up or an identity provider and
   * stays that way when Better Auth adds a column.
   */
  readonly auth: Auth;
}

/** One member, as the SCIM surface describes them. */
export interface DirectoryMember {
  readonly memberId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly active: boolean;
}

export interface ProvisionDirectoryUserInput {
  readonly workspaceId: string;
  readonly email: string;
  readonly name: string;
  /** The directory's own id for this person. Recorded on the audit row. */
  readonly externalId?: string;
  /** A directory may create somebody already deactivated. Defaults to true. */
  readonly active?: boolean;
}

export interface ProvisionDirectoryUserResult {
  readonly member: DirectoryMember;
  /** Whether this call is what added them to the workspace. */
  readonly created: boolean;
}

/**
 * A SCIM filter, as far as this surface reads one.
 *
 * `userName eq "someone@acme.com"` is the one filter Okta and Entra send, and
 * they send it constantly: it is how they ask whether somebody is already
 * here before creating them. RFC 7644 defines a whole language, and
 * supporting the part that is used beats refusing the request or, worse,
 * ignoring the filter and answering with everybody.
 */
export interface ScimFilter {
  readonly attribute: "userName" | "externalId";
  readonly value: string;
}

const FILTER = /^\s*(userName|externalId)\s+eq\s+"([^"]*)"\s*$/i;

/** Reads a filter, or null when there is none and no when it is unsupported. */
export function parseScimFilter(
  filter: string | null | undefined,
): ScimFilter | null | "unsupported" {
  if (!filter || filter.trim() === "") {
    return null;
  }
  const match = FILTER.exec(filter);
  if (!match) {
    return "unsupported";
  }
  const attribute =
    match[1]?.toLowerCase() === "externalid" ? "externalId" : "userName";
  return { attribute, value: match[2] ?? "" };
}

/** The account with this address, or null. Better Auth owns the table. */
async function accountByEmail(
  pool: Pool,
  email: string,
): Promise<{ id: string; name: string } | null> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    "select id, name from users where email = $1",
    [email.toLowerCase()],
  );
  return rows[0] ?? null;
}

/**
 * Creates or finds the account, then makes them a member of the workspace.
 *
 * Idempotent in both halves: an address that already has an account reuses
 * it, and somebody who is already a member is returned rather than added a
 * second time. A directory replays its own state constantly, so this being
 * safe to call repeatedly is the difference between a working integration and
 * a duplicated one.
 */
export async function provisionDirectoryUser(
  deps: DirectoryDeps,
  input: ProvisionDirectoryUserInput,
): Promise<ProvisionDirectoryUserResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await accountByEmail(deps.pool, email);

  let userId: string;
  let created: boolean;

  if (existing) {
    userId = existing.id;
    const joined = await joinWorkspaceForIdentity(deps.pool, {
      workspaceId: input.workspaceId,
      user: { id: existing.id, name: input.name },
      via: "directory_sync",
      ...(input.externalId ? { externalId: input.externalId } : {}),
    });
    created = joined.created;
  } else {
    // **The account is created through Better Auth, inside the authority.**
    // The authority does two things the hooks cannot otherwise know: it tells
    // the registration rule that a token the workspace issued authorised
    // this, and it tells the provisioning hook which workspace the person
    // belongs to, so they join it instead of getting one of their own.
    const context = await deps.auth.$context;
    const account = await withProvisioningAuthority(
      {
        kind: "directory_sync",
        workspaceId: input.workspaceId,
        ...(input.externalId ? { externalId: input.externalId } : {}),
      },
      () =>
        context.internalAdapter.createUser<{ id: string }>(
          {
            email,
            name: input.name,
            // The directory is the authority on this address. Asking somebody
            // provisioned by their employer to confirm an address their
            // employer supplied would block a sign-in on a mail round trip
            // that proves nothing new.
            emailVerified: true,
          },
          { method: "scim" },
        ),
    );
    userId = account.id;
    created = true;
  }

  const member = await requireMember(deps.pool, input.workspaceId, userId);

  if (input.active === false && member.active) {
    await setDirectoryUserActive(deps.pool, {
      workspaceId: input.workspaceId,
      memberId: member.memberId,
      active: false,
    });
    return { member: { ...member, active: false }, created };
  }

  return { member, created };
}

/**
 * Suspends or restores a member, through the actions that own that column.
 *
 * A system actor: the bearer token was verified before this was called, which
 * is the same arrangement every other system path uses. `people.suspend`
 * refuses to suspend the last full-access holder, so a directory cannot lock
 * a workspace out of itself by removing the wrong person.
 */
export async function setDirectoryUserActive(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly active: boolean;
  },
): Promise<DirectoryMember> {
  await callAction(
    {
      pool,
      workspaceId: input.workspaceId,
      actor: { kind: "system" },
    },
    input.active ? "people.restore" : "people.suspend",
    { memberId: input.memberId },
  );
  const member = await memberById(pool, input.workspaceId, input.memberId);
  if (!member) {
    throw new Error("The member disappeared while its status was changing.");
  }
  return member;
}

/**
 * Members of the workspace, oldest first, optionally narrowed by a filter.
 *
 * Raw SQL because it joins Better Auth's own `users` table, which has no
 * Drizzle relation here and no workspace column of its own. Inside the tenant
 * transaction, so the membership half is the floor's answer rather than a
 * WHERE clause somebody could forget.
 */
export async function listDirectoryUsers(
  pool: Pool,
  workspaceId: string,
  filter?: ScimFilter | null,
): Promise<readonly DirectoryMember[]> {
  const email =
    filter?.attribute === "userName" ? filter.value.toLowerCase() : null;

  const { rows } = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx.execute<{
      member_id: string;
      user_id: string;
      name: string;
      email: string;
      status: string;
    }>(sql`
      select m.id as member_id, m.user_id, m.name, u.email, m.status
        from workspace_members m
        join users u on u.id = m.user_id
       where m.workspace_id = ${workspaceId}
         and m.kind = 'human'
         and m.deleted_at is null
         and (${email}::text is null or lower(u.email) = ${email})
       order by m.created_at`),
  );

  return rows.map((row) => ({
    memberId: row.member_id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    active: row.status === "active",
  }));
}

/** One member by id, or null. */
export async function memberById(
  pool: Pool,
  workspaceId: string,
  memberId: string,
): Promise<DirectoryMember | null> {
  const members = await listDirectoryUsers(pool, workspaceId);
  return members.find((member) => member.memberId === memberId) ?? null;
}

/** One member by the account behind them. Throws if provisioning lost them. */
async function requireMember(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<DirectoryMember> {
  const members = await listDirectoryUsers(pool, workspaceId);
  const member = members.find((candidate) => candidate.userId === userId);
  if (!member) {
    throw new Error(
      "The account was provisioned but no membership followed it.",
    );
  }
  return member;
}
