import {
  emailDomain,
  listMembershipsForUser,
  trustedDomainOffers,
} from "@openokr/core";
import { Button, Card, CardBody } from "@openokr/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPool } from "../../lib/pool";
import { requireSession } from "../../lib/session";
import { getTranslations } from "../../lib/translations";
import { startOwnWorkspace } from "./trusted-actions.ts";
import { TrustedOfferForm } from "./trusted-offer-form.tsx";

/**
 * The workspaces your email domain lets you join (REQUIREMENTS §4 People and
 * org, P6-G06b "trusted-domain joining offered where the workspace allows
 * it"; completeness review M-34).
 *
 * **An administrator could trust a domain and nothing happened.** The setting
 * was saved on the general card, `invitations.joinByTrustedDomain` checked it,
 * and nothing in the product ever asked which workspaces trust a domain, so
 * nobody was ever offered one. This is where they are.
 *
 * **Offered, one press each, never joined behind somebody's back.** The plan's
 * own word is "offered", and a person with a company address may well want a
 * workspace of their own, or may be one of several an organisation runs. So
 * somebody with no workspace yet chooses here between the ones that trust them
 * and one of their own, and nothing is made until they do.
 *
 * **Outside the shell, like the invitation page beside it**, because the
 * person this is first for has no workspace yet and the shell is a
 * workspace's. It never calls `requireWorkspace`, which is what sends a person
 * with no workspace here, so there is no loop.
 *
 * With nothing on offer it sends them to the front door, which gives a person
 * with no workspace their own, exactly as it did before.
 */

export const dynamic = "force-dynamic";

export default async function TrustedDomainJoinPage() {
  const session = await requireSession();
  const pool = getPool();

  const offers = await trustedDomainOffers(pool, session.user.id);
  if (offers.length === 0) {
    redirect("/");
  }
  const memberships = await listMembershipsForUser(pool, session.user.id);
  const { t } = await getTranslations();

  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <Card className="w-full">
        <CardBody className="flex flex-col gap-3.5">
          <h1 className="text-lg font-bold text-ink">
            {t("join.trusted.heading")}
          </h1>
          <p className="text-sm text-ink-2">
            {t("join.trusted.yourAddressAt", {
              domain: emailDomain(session.user.email),
            })}
          </p>
          <ul className="flex flex-col gap-2.5">
            {offers.map((offer) => (
              <li key={offer.workspaceId}>
                <TrustedOfferForm
                  workspaceId={offer.workspaceId}
                  workspaceName={offer.workspaceName}
                />
              </li>
            ))}
          </ul>
          {memberships.length === 0 ? (
            <form
              action={startOwnWorkspace}
              className="flex flex-col items-start gap-1.5 border-t border-line pt-3"
            >
              <p className="text-xs text-ink-3">
                {t("join.trusted.orStartYourOwn")}
              </p>
              <Button type="submit" variant="default" size="sm">
                {t("join.trusted.startMyOwn")}
              </Button>
            </form>
          ) : (
            <Link
              href="/"
              className="border-t border-line pt-3 text-sm font-medium text-brand-text hover:underline"
            >
              {t("join.trusted.notNow")}
            </Link>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
