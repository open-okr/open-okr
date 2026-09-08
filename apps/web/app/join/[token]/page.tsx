import { previewInvite } from "@openokr/core";
import { Button, Card, CardBody } from "@openokr/ui";
import Link from "next/link";
import { getPool } from "../../../lib/pool";
import { currentSession } from "../../../lib/session";
import { acceptInvitation, startSignUp } from "./actions.ts";
import { JoinButton } from "./join-button.tsx";

/**
 * Accepting an invitation (GAP-AUDIT B-07, P6-G06b).
 *
 * **The address an administrator hands out led nowhere.** `sendInvitation` has
 * mailed `<base>/join/<token>` since P1-T07 and no such route existed, so
 * every invitation this product has ever sent was a 404. The card built at
 * P6-G06a knew it and handed out the bare token with a note saying where it
 * would one day be usable. This is that place.
 *
 * **The token names the workspace, not the URL.** Migration 0010 assumed a
 * slug would sit beside it and nothing ever built the address that way, so
 * 0075 gives `invite_links` the second-key policy `api_tokens` has and
 * `previewInvite` answers which workspace a digest belongs to without
 * consuming it.
 *
 * **One refusal for every reason.** Revoked, expired, used up, issued to
 * somebody else or never real all render the same sentence. Saying "that
 * invitation was revoked" would confirm to a stranger that it existed, and
 * naming the workspace would tell them who to try next.
 *
 * **Nothing is consumed by looking.** A visitor who opens the link, goes to
 * make a cup of tea and comes back has not burned a single-use invitation.
 */

export const dynamic = "force-dynamic";

function Refusal() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <Card className="w-full">
        <CardBody className="flex flex-col gap-3">
          <h1 className="text-lg font-bold text-ink">
            That invitation cannot be used
          </h1>
          <p className="text-sm text-ink-2">
            It may have been withdrawn, already used, or it may have expired.
            Ask whoever invited you for a fresh one.
          </p>
          <Link
            href="/sign-in"
            className="text-sm font-medium text-brand-text hover:underline"
          >
            Sign in instead
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await previewInvite(getPool(), {
    token,
    now: new Date(),
  });

  if (invitation.kind !== "usable") {
    return <Refusal />;
  }

  const session = await currentSession();

  if (!session) {
    // **The token is stored by `startSignUp`, not by this render.** Next
    // refuses a cookie write during render ("Cookies can only be modified in a
    // Server Action or Route Handler") and the first draft did it here, which
    // made the page throw. The button is better anyway: storing a credential
    // is something the visitor chooses rather than something a page look
    // causes.
    //
    // Signing in needs no cookie at all. `next` brings them back here, and by
    // then they have a session and the Join button below is what they press.
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
        <Card className="w-full">
          <CardBody className="flex flex-col gap-3.5">
            <h1 className="text-lg font-bold text-ink">
              You have been invited to {invitation.workspaceName}
            </h1>
            <p className="text-sm text-ink-2">
              {invitation.email
                ? `The invitation is for ${invitation.email}. Create an account with that address and you will land straight in the workspace.`
                : "Create an account and you will land straight in the workspace."}
            </p>
            <div className="flex items-center gap-2.5">
              <JoinButton action={startSignUp} token={token}>
                <Button type="submit" variant="default" size="sm">
                  Create an account
                </Button>
              </JoinButton>
              <Link
                href={`/sign-in?next=${encodeURIComponent(`/join/${token}`)}`}
                className="text-sm font-medium text-brand-text hover:underline"
              >
                I already have one
              </Link>
            </div>
            <p className="text-xs text-ink-3">
              Signing in with an existing account brings you back here to
              accept.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <Card className="w-full">
        <CardBody className="flex flex-col gap-3.5">
          <h1 className="text-lg font-bold text-ink">
            Join {invitation.workspaceName}
          </h1>
          <p className="text-sm text-ink-2">
            You are signed in as {session.user.email}.
            {invitation.email && invitation.email !== session.user.email
              ? " This invitation was issued to a different address, so it will be refused. Sign in as that person, or ask for one of your own."
              : ""}
          </p>
          <JoinButton action={acceptInvitation} token={token}>
            <Button type="submit" variant="default" size="sm">
              Join {invitation.workspaceName}
            </Button>
          </JoinButton>
        </CardBody>
      </Card>
    </div>
  );
}
