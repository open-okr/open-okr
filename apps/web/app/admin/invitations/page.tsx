import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";
import { createPersonalLinkAction, createWorkspaceLinkAction } from "./actions";
import { InviteForm } from "./invite-form";
import { RevokeButton } from "./revoke-button";

/**
 * Invitations (UIUX-PLAN.md §6 S-36, TECHNICAL-PLAN §4.1, P6-G06).
 *
 * **Until this existed, a self-hosted instance was a one-person instance.**
 * P2-T04 built the whole invitation funnel at P2-T04 and no screen ever reached
 * it: five registered actions, no caller anywhere in `apps/web`, and the words
 * "invite" and "invitation" appearing only in sign-up copy. Registration closes
 * after the first user (P1-T06), so the only way to add a second person was the
 * command line. The gap audit of 7 September 2026 recorded it as B-07.
 *
 * **Two shapes, because they answer different questions.** A personal link is
 * for one address and is used once, which is what an administrator wants when
 * they are inviting a named person. A workspace link is for a channel or a
 * document: anyone holding it may join, bounded by a use count, an expiry and
 * an optional domain list. Trusted-domain joining is a third path and lives on
 * the general card, because it is a property of the workspace rather than an
 * invitation somebody issued.
 *
 * **A token is shown once.** The table holds its digest, which is what makes a
 * leaked list of invitations harmless, so the list below carries no tokens and
 * the form says "copy this now" before the button rather than after.
 */

const shortDate = (value: string | null): string =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(value))
    : "";

/** What a link is doing right now, in the order the states actually matter. */
function stateOf(link: {
  revokedAt: string | null;
  expiresAt: string | null;
  useCount: number;
  maxUses: number | null;
}): { label: string; tone: "ok" | "neutral" | "warn" | "bad" } {
  if (link.revokedAt) {
    return { label: "Revoked", tone: "bad" };
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return { label: "Expired", tone: "warn" };
  }
  if (link.maxUses !== null && link.useCount >= link.maxUses) {
    return { label: "Used up", tone: "warn" };
  }
  return { label: "Open", tone: "ok" };
}

export default async function InvitationsPage() {
  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  // The layout already refuses below `full`. Checked again here because a
  // hidden control is cosmetic and this page names email addresses.
  if (level < ACCESS_LEVELS.full) {
    return (
      <>
        <h1 className="mb-4 text-lg font-bold text-ink">Invitations</h1>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-3">
              Only a workspace administrator can invite people. Ask one of yours
              to add you to this screen.
            </p>
          </CardBody>
        </Card>
      </>
    );
  }

  const links = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human" as const, userId: session.user.id },
    },
    "invitations.list",
    {},
  );

  return (
    <>
      <h1 className="mb-4 text-lg font-bold text-ink">Invitations</h1>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <div className="flex min-w-0 flex-col">
              <h2 className="text-sm font-bold text-ink">Invite one person</h2>
              <p className="text-xs text-ink-3">
                One address, one use. They join with the workspace defaults and
                the audit names you.
              </p>
            </div>
          </CardHeader>
          <CardBody>
            <InviteForm
              action={createPersonalLinkAction}
              submitLabel="Create the invitation"
            >
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                Email address
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="name@example.com"
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                Expires in days
                <input
                  name="expiresInDays"
                  type="number"
                  min={1}
                  defaultValue={14}
                  className="w-28 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
            </InviteForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex min-w-0 flex-col">
              <h2 className="text-sm font-bold text-ink">
                Create a link to share
              </h2>
              <p className="text-xs text-ink-3">
                For a channel or a document. Bound it with a use count, an
                expiry, or the domains you will accept.
              </p>
            </div>
          </CardHeader>
          <CardBody>
            <InviteForm
              action={createWorkspaceLinkAction}
              submitLabel="Create the link"
            >
              <div className="flex flex-wrap gap-2.5">
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  Maximum uses
                  <input
                    name="maxUses"
                    type="number"
                    min={1}
                    placeholder="No limit"
                    className="w-28 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  Expires in days
                  <input
                    name="expiresInDays"
                    type="number"
                    min={1}
                    defaultValue={30}
                    className="w-28 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                Allowed domains
                <input
                  name="allowedDomains"
                  placeholder="example.com, example.org"
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
                <span className="text-ink-4">
                  Leave empty to accept any address. A domain list refuses
                  everyone else at the moment they try to join.
                </span>
              </label>
            </InviteForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex min-w-0 flex-col">
              <h2 className="text-sm font-bold text-ink">Issued</h2>
              <p className="text-xs text-ink-3">
                Revoked and expired links stay here. Whether you already invited
                somebody is a question about history.
              </p>
            </div>
          </CardHeader>
          <CardBody>
            {links.length === 0 ? (
              <p className="text-sm text-ink-3">
                Nothing issued yet. Everybody in this workspace either created
                it or was added from the command line.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {links.map((link) => {
                  const state = stateOf(link);
                  const revocable = !link.revokedAt;
                  return (
                    <li
                      key={link.id}
                      className="flex flex-wrap items-center justify-between gap-2.5 border-line border-b pb-2 last:border-0 last:pb-0"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="text-sm text-ink">
                          {link.email ?? "Anyone with the link"}
                        </span>
                        <span className="text-xs text-ink-4">
                          {link.mode === "personal" ? "Personal" : "Workspace"}
                          {" · "}
                          {link.useCount}
                          {link.maxUses === null
                            ? " uses"
                            : ` of ${link.maxUses} uses`}
                          {link.expiresAt
                            ? ` · expires ${shortDate(link.expiresAt)}`
                            : ""}
                          {link.allowedDomains.length > 0
                            ? ` · ${link.allowedDomains.join(", ")}`
                            : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Chip tone={state.tone}>{state.label}</Chip>
                        {revocable ? <RevokeButton linkId={link.id} /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
