/**
 * Sign-in accounts for the Northwind cast on an otherwise empty workspace, for
 * the manual acceptance test (docs/testing/OpenOKR-UAT.xlsx).
 *
 * The workbook starts from a fresh instance and has the tester build
 * everything through the screens. Creating seven accounts by invitation is
 * the one part of that worth doing once rather than seven times: it takes half
 * an hour, needs seven browser windows before any real testing starts, and
 * tests the same path each time. So this creates the seven people and nothing
 * else. Titles, managers, spaces and every goal are still the tester's job,
 * because those are what the later modules test.
 *
 * **How a persona joins is the product's own path.** The administrator creates
 * a workspace invitation, each persona's account accepts it through
 * `invitations.acceptLink`, and the link is revoked at the end. The member row,
 * its access binding, the activity and the audit rows are exactly what a
 * person clicking the link would leave. Only the account itself is made
 * server-side, through Better Auth, because there is no browser to sign up in.
 *
 * **Addresses are plus-addresses on one inbox** (`qa@example.com` gives
 * `qa+priya@example.com`), so every mail the test causes, a password reset
 * included, lands somewhere a tester can read it.
 *
 * **What it refuses:** a workspace with a person in it who is not the
 * founder and not one of these seven. That is a workspace somebody is using,
 * and giving it seven invented accounts that share one password is the
 * mistake this command must not be able to make.
 */
import { activeOnly, withWorkspace, workspaceMembers } from "@openokr/db";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { callAction } from "../actions/registry.ts";
import type { createAuth } from "../auth/auth.ts";
import { OperationError } from "../operations/errors.ts";
import { INVENTED_CAST } from "./cast.ts";
import { accountFor } from "./personas.ts";

type Auth = ReturnType<typeof createAuth>;

/**
 * The password every UAT persona shares unless `--password` says otherwise.
 *
 * Chosen by the person running the test programme on 25 September 2026, who
 * preferred one known value for a staging instance over a flag that must be
 * remembered. It is not a secret and is written in the workbook, which is why
 * `refuseUnlessEmpty` below refuses any workspace somebody is really using.
 */
export const UAT_PERSONA_PASSWORD = "northwind-uat-2026";

export interface PrepareUatPersonasInput {
  readonly pool: Pool;
  readonly workspaceId: string;
  /** The founder, who issues the invitation every persona accepts. */
  readonly adminUserId: string;
  readonly auth: Auth;
  /** The inbox the plus-addresses hang off, for example qa@example.com. */
  readonly inbox: string;
  readonly password?: string;
}

interface UatPersona {
  readonly key: string;
  readonly name: string;
  readonly email: string;
  /** Whether this run is what made them a member. */
  readonly joined: boolean;
}

export interface PrepareUatPersonasResult {
  readonly personas: readonly UatPersona[];
  readonly joined: number;
  readonly password: string;
}

/** `qa@example.com` and `priya` give `qa+priya@example.com`. */
export function personaAddress(inbox: string, key: string): string {
  const at = inbox.lastIndexOf("@");
  return `${inbox.slice(0, at)}+${key}@${inbox.slice(at + 1)}`.toLowerCase();
}

/**
 * Why this inbox cannot carry the plus-addresses, or null when it can. The
 * command turns a reason into a usage error before anything is written.
 */
export function inboxProblem(inbox: string): string | null {
  const value = inbox.trim();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1 || /\s/.test(value)) {
    return `"${inbox}" is not an email address. Give the inbox the personas' mail should reach, for example qa@example.com.`;
  }
  if (value.slice(0, at).includes("+")) {
    return `"${inbox}" already has a plus in it. Give the plain inbox; each persona adds its own +name.`;
  }
  return null;
}

/** Why this password is refused, or null. The sign-up page's own minimum. */
export function passwordProblem(password: string): string | null {
  return password.length < 12
    ? "The persona password must be at least 12 characters, the same rule the sign-up page applies."
    : null;
}

type Context = {
  pool: Pool;
  workspaceId: string;
  actor: { kind: "human"; userId: string };
};

export async function prepareUatPersonas(
  input: PrepareUatPersonasInput,
): Promise<PrepareUatPersonasResult> {
  const password = input.password ?? UAT_PERSONA_PASSWORD;
  const problem = inboxProblem(input.inbox) ?? passwordProblem(password);
  if (problem) {
    throw new OperationError("forbidden", problem);
  }
  const inbox = input.inbox.trim().toLowerCase();

  const cast = INVENTED_CAST.map((person) => ({
    key: person.key,
    name: person.name,
    email: personaAddress(inbox, person.key),
  }));

  const admin: Context = {
    pool: input.pool,
    workspaceId: input.workspaceId,
    actor: { kind: "human", userId: input.adminUserId },
  };

  const members = await membersWithAccounts(input.pool, input.workspaceId);
  refuseUnlessEmpty(members, input.adminUserId, cast);

  const missing = cast.filter(
    (person) => !members.some((m) => m.email === person.email),
  );

  const personas: UatPersona[] = cast
    .filter((person) => !missing.includes(person))
    .map((person) => ({ ...person, joined: false }));

  if (missing.length > 0) {
    const domain = inbox.slice(inbox.lastIndexOf("@") + 1);
    const link = await callAction(admin, "invitations.createWorkspaceLink", {
      maxUses: missing.length,
      expiresInDays: 1,
      allowedDomains: [domain],
    });
    try {
      for (const person of missing) {
        const userId = await accountFor(
          { ...input, password },
          person.name,
          person.email,
        );
        await callAction(
          {
            pool: input.pool,
            workspaceId: input.workspaceId,
            actor: { kind: "human", userId },
          },
          "invitations.acceptLink",
          { token: link.token },
        );
        personas.push({ ...person, joined: true });
      }
    } finally {
      // Revoked whether or not every persona made it, so no usable link is
      // left behind by a run that stopped halfway.
      await callAction(admin, "invitations.revokeLink", { linkId: link.id });
    }
  }

  const order: string[] = cast.map((person) => person.key);
  personas.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return {
    personas,
    joined: personas.filter((one) => one.joined).length,
    password,
  };
}

/** Every human member with an account, and that account's address. */
async function membersWithAccounts(
  pool: Pool,
  workspaceId: string,
): Promise<{ userId: string; email: string }[]> {
  // Inside the tenant setting: `workspace_members` is behind the tenant
  // floor and the application role cannot see past it. Better Auth owns
  // `users`, which has no floor, so the address is read beside it.
  const rows = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.kind, "human"),
          ),
          sql`${workspaceMembers.userId} is not null`,
        ),
      ),
  );
  const ids = rows.map((row) => row.userId).filter((id): id is string => !!id);
  if (ids.length === 0) {
    return [];
  }
  const { rows: users } = await pool.query<{ id: string; email: string }>(
    "select id, lower(email) as email from users where id = any($1)",
    [ids],
  );
  return users.map((user) => ({ userId: user.id, email: user.email }));
}

function refuseUnlessEmpty(
  members: readonly { userId: string; email: string }[],
  founderId: string,
  cast: readonly { email: string }[],
): void {
  const strangers = members.filter(
    (m) => m.userId !== founderId && !cast.some((p) => p.email === m.email),
  );
  if (strangers.length > 0) {
    throw new OperationError(
      "forbidden",
      `This workspace already has ${strangers.length} other member(s), so somebody is using it. UAT personas are only given to a workspace that holds nobody but its founder.`,
    );
  }
}
