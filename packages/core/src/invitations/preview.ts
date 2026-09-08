import {
  activeOnly,
  type InviteLink,
  inviteLinks,
  withInviteToken,
  withWorkspace,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { emailDomain, hashInviteToken } from "./tokens.ts";

/**
 * What an invitation token is for, without consuming it (P6-G06b).
 *
 * **The address an administrator hands out named no workspace.**
 * `sendInvitation` has mailed `<base>/join/<token>` since P1-T07 and the
 * invitations card issued one at P6-G06a, and `invitations.acceptLink` is a
 * workspace-scoped action: it needs to be told which workspace before it can
 * look the token up. So the first question a visitor's arrival asks, which
 * workspace is this, was the one thing nothing could answer. Migration 0010
 * assumed the URL would carry a slug and nothing ever built it that way.
 *
 * This is the answer, and it runs in the pre-tenant transaction migration 0075
 * opens: the only row it can reach is the one whose digest the caller already
 * holds. Somebody guessing learns nothing, including whether a token exists,
 * because every refusal below is the same refusal.
 *
 * **It consumes nothing.** A preview that incremented `use_count` would burn a
 * single-use invitation on a page load, and a visitor who opens the link twice
 * before signing up is ordinary.
 */

/** Why a token cannot be used. One word, and the caller says the same thing. */
export type InviteRefusal =
  | "invalid"
  | "revoked"
  | "expired"
  | "used_up"
  | "already_taken";

export interface InvitePreview {
  readonly kind: "usable";
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceSlug: string;
  readonly mode: "workspace" | "personal";
  /**
   * The one address a personal invitation was issued to, so the sign-up form
   * can pre-fill it and refuse a different one. Null for a shareable link.
   */
  readonly email: string | null;
  /** The domains a shareable link is bounded to, empty when unbounded. */
  readonly allowedDomains: readonly string[];
}

export type InviteResolution =
  | InvitePreview
  | { readonly kind: "refused"; readonly reason: InviteRefusal };

/**
 * Reads what a token admits, and refuses identically whatever the reason.
 *
 * The reason is returned for the caller's own logging and for the tests, and
 * the `/join` route deliberately renders one sentence for all of them: telling
 * a visitor "that invitation was revoked" rather than "that link is not usable"
 * confirms it existed and names a workspace to somebody who was not invited.
 */
export async function previewInvite(
  pool: Pool,
  input: { readonly token: string; readonly now: Date },
): Promise<InviteResolution> {
  const raw = input.token.trim();
  if (raw === "") {
    return { kind: "refused", reason: "invalid" };
  }

  const hash = hashInviteToken(raw);
  const db = drizzle(pool);
  const link = await withInviteToken(db, hash, async (tx) => {
    const [found] = await tx
      .select()
      .from(inviteLinks)
      .where(activeOnly(inviteLinks, eq(inviteLinks.tokenHash, hash)))
      .limit(1);
    return found as InviteLink | undefined;
  });

  if (!link) {
    return { kind: "refused", reason: "invalid" };
  }
  const refusal = refuseReason(link, input.now);
  if (refusal) {
    return { kind: "refused", reason: refusal };
  }

  // The token has named a workspace, so the ordinary tenant setting applies and
  // the name is an ordinary read under it.
  const workspace = await withWorkspace(db, link.workspaceId, async (tx) => {
    const [found] = await tx
      .select({ name: workspaces.name, slug: workspaces.slug })
      // openokr:allow-raw-read: the workspace this token admits, by the id the
      // token itself named. There is no member yet to scope a getter by, which
      // is the whole condition this function exists for.
      .from(workspaces)
      .where(activeOnly(workspaces, eq(workspaces.id, link.workspaceId)))
      .limit(1);
    return found;
  });
  if (!workspace) {
    // The workspace was deleted after the invitation was issued. Refused as
    // invalid rather than as a dangling row, because that is what it is to the
    // person holding the link.
    return { kind: "refused", reason: "invalid" };
  }

  return {
    kind: "usable",
    workspaceId: link.workspaceId,
    workspaceName: workspace.name,
    workspaceSlug: workspace.slug,
    mode: link.mode,
    email: link.email ?? null,
    allowedDomains: link.allowedDomains ?? [],
  };
}

/**
 * The four states that make a token unusable, in the order acceptance checks
 * them.
 *
 * Shared with `invitations.acceptLink` rather than restated, so a preview
 * cannot say usable about something acceptance then refuses. That divergence
 * is the whole failure mode of having two readers of one row.
 */
export function refuseReason(
  link: Pick<
    InviteLink,
    "mode" | "revokedAt" | "expiresAt" | "memberId" | "useCount" | "maxUses"
  >,
  now: Date,
): InviteRefusal | null {
  if (link.revokedAt) {
    return "revoked";
  }
  if (link.expiresAt && link.expiresAt.getTime() < now.getTime()) {
    return "expired";
  }
  // A personal link is single-use by having been used: `member_id` is the
  // member it created, which is why migration 0010 stores no `max_uses` of 1.
  if (link.mode === "personal" && link.memberId) {
    return "already_taken";
  }
  if (link.maxUses !== null && link.useCount >= link.maxUses) {
    return "used_up";
  }
  return null;
}

/**
 * Whether this address may accept this invitation.
 *
 * A personal invitation admits exactly the address it was issued to. A
 * shareable one with domains admits any address inside them, and one without
 * admits anybody who holds the token.
 */
export function addressMayAccept(
  link: Pick<InvitePreview, "mode" | "email" | "allowedDomains">,
  email: string,
): boolean {
  const address = email.trim().toLowerCase();
  if (link.mode === "personal") {
    return link.email !== null && link.email.toLowerCase() === address;
  }
  if (link.allowedDomains.length === 0) {
    return true;
  }
  // `emailDomain` answers "" for an address with no @, not null.
  const domain = emailDomain(address);
  return domain !== "" && link.allowedDomains.includes(domain);
}
