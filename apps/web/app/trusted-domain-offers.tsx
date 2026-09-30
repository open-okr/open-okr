import { emailDomain, trustedDomainOffers } from "@openokr/core";
import { Card, CardBody } from "@openokr/ui";
import { getPool } from "../lib/pool";
import { getTranslations } from "../lib/translations";
import { TrustedOfferForm } from "./join/trusted-offer-form.tsx";

/**
 * The workspaces a member's domain admits, offered on the front door
 * (completeness review M-34).
 *
 * **For somebody who already has a workspace.** A person with none is sent to
 * the join page before anything is made for them; this is the other half, the
 * member who signed up before their company trusted its domain, or who was
 * invited somewhere else first. The front door is where every sign-in lands,
 * so it is where "after sign-in, offered" is true for them.
 *
 * Nothing at all is drawn when nothing is on offer, which is every member of
 * every workspace that trusts no domain, and every address not yet confirmed.
 */
export async function TrustedDomainOffers({
  userId,
  email,
}: {
  readonly userId: string;
  readonly email: string;
}) {
  // A failed read loses an offer, never the Work Map under it. The join page
  // asks again, and so does the next visit here.
  const offers = await trustedDomainOffers(getPool(), userId).catch(() => []);
  if (offers.length === 0) {
    return null;
  }
  const { t } = await getTranslations();

  return (
    <Card>
      <CardBody className="flex flex-col gap-2.5">
        <h2 className="text-sm font-bold text-ink">
          {t("join.trusted.heading")}
        </h2>
        <p className="text-xs text-ink-3">
          {t("join.trusted.yourAddressAt", { domain: emailDomain(email) })}
        </p>
        <ul className="flex flex-col gap-2">
          {offers.map((offer) => (
            <li key={offer.workspaceId}>
              <TrustedOfferForm
                workspaceId={offer.workspaceId}
                workspaceName={offer.workspaceName}
              />
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
