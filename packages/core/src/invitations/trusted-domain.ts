/**
 * The workspaces a person may join because they trust the domain of the
 * person's address (completeness review M-34).
 *
 * **The setting was saved and changed nothing.** An administrator can list
 * trusted domains on the general card and `invitations.joinByTrustedDomain`
 * checks them, but that action runs inside one named workspace, and which
 * workspaces trust a domain is the one question a person who belongs to none
 * of them could not ask. So nothing ever called it.
 *
 * This is the answer, read through the narrow key migration 0104 adds. It
 * returns a workspace's id and name and nothing else: the id is what the join
 * runs under, and the name is what the person chooses by. The settings that
 * made the row readable are never selected.
 *
 * **A confirmed address only.** Anybody can type an address at somebody else's
 * company into a sign-up form. Until the address is confirmed the answer is
 * nothing, so a trusted domain admits the people who can read that domain's
 * mail and nobody else. An instance with no mail confirms nobody, so trusted
 * domains there admit nobody either, which `docs/admin/settings.md` says.
 *
 * **Nothing somebody decided is undone.** A workspace where this person has a
 * member row already is left out, whatever state the row is in. Live, they are
 * in it. Suspended or removed, somebody chose that, and a domain is not an
 * administrator changing their mind.
 */
import {
  activeOnly,
  includeDeleted,
  users,
  withTrustedEmailDomain,
  withWorkspace,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { trustedEmailDomainsSchema } from "../settings/registry.ts";
import { emailDomain } from "./tokens.ts";

/** A workspace this person may join, as the choice is offered. */
export interface TrustedDomainOffer {
  readonly workspaceId: string;
  readonly workspaceName: string;
}

/** The live, writable workspaces trusting this domain, by name. */
async function workspacesTrusting(
  pool: Pool,
  domain: string,
): Promise<readonly TrustedDomainOffer[]> {
  // A domain the general card would refuse to store is in nobody's list, so
  // it is answered here rather than handed to the key, which refuses anything
  // that is not a plain lower-case domain by throwing. An address with no @,
  // or an internationalised one, is an ordinary account and not an error.
  const stored = trustedEmailDomainsSchema.safeParse([domain]);
  if (!stored.success || stored.data[0] !== domain) {
    return [];
  }
  const rows = await withTrustedEmailDomain(drizzle(pool), domain, (tx) =>
    tx
      .select({ workspaceId: workspaces.id, workspaceName: workspaces.name })
      // openokr:allow-raw-read: the workspaces that published this domain as
      // trusted, through the one key that admits them. There is no member yet
      // to scope a getter by, which is the whole condition this exists for,
      // and only the id and the name are read.
      .from(workspaces)
      // A frozen or read-only workspace refuses the join, so offering it would
      // offer something that fails.
      .where(activeOnly(workspaces, eq(workspaces.state, "active")))
      .orderBy(asc(workspaces.name), asc(workspaces.id)),
  );
  return rows;
}

/** Whether this person has any member row in that workspace, in any state. */
async function hasMemberRow(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        // Deleted rows included on purpose: a member somebody removed is one a
        // domain must not bring back.
        includeDeleted(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}

/**
 * The workspaces this person may join by domain, and nothing when their
 * address is unconfirmed.
 *
 * Read from the account row rather than the session, because the session is
 * the browser's copy and the account is where confirming an address lands.
 */
export async function trustedDomainOffers(
  pool: Pool,
  userId: string,
): Promise<readonly TrustedDomainOffer[]> {
  const [account] = await drizzle(pool)
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account?.emailVerified) {
    return [];
  }

  const candidates = await workspacesTrusting(pool, emailDomain(account.email));
  const offers: TrustedDomainOffer[] = [];
  // One at a time, and it is a short list: a domain is trusted by the
  // workspaces of one organisation.
  for (const candidate of candidates) {
    if (!(await hasMemberRow(pool, candidate.workspaceId, userId))) {
      offers.push(candidate);
    }
  }
  return offers;
}

/**
 * Whether any workspace trusts this address's domain, confirmed or not.
 *
 * For the sign-up hook only, and it decides nothing about joining. A person
 * signing up has not confirmed their address yet, so they cannot be offered
 * anything; what this answers is whether to hold off giving them a workspace
 * of their own until they can be. Creating one first would leave everybody
 * who then joins their company's workspace holding a stray empty one, which is
 * the mistake P6-G06b avoided for invitations.
 */
export async function domainIsTrusted(
  pool: Pool,
  email: string,
): Promise<boolean> {
  return (await workspacesTrusting(pool, emailDomain(email))).length > 0;
}
