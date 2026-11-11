import type { EmailConfirmation } from "@openokr/core";
import { Button, Card, CardBody, CardHeader } from "@openokr/ui";
import { getTranslations } from "./translations";

/**
 * Whether a new account confirms its email before it signs in (plan 0.8.0
 * S4, docs/design/email-verification.md §11.1).
 *
 * One card for two screens: Admin, General on a self-hosted or group
 * instance, and the operator's Instance screen on a cloud, where the
 * accounts are shared by every customer and the choice is the operator's
 * (Q12). Each screen passes its own action, which checks its own grant.
 *
 * Under the `company_domains` registration policy `off` is not offered,
 * because that policy trusts the domain an address claims (Q13).
 */
export async function EmailConfirmationCard({
  confirmation,
  save,
}: {
  readonly confirmation: EmailConfirmation;
  readonly save: (formData: FormData) => Promise<void>;
}) {
  const { t } = await getTranslations();
  const choices = [
    {
      value: "auto",
      title: t("admin.emailConfirmation.auto"),
      hint: t("admin.emailConfirmation.autoHint"),
      disabled: false,
    },
    {
      value: "off",
      title: t("admin.emailConfirmation.off"),
      hint: t("admin.emailConfirmation.offHint"),
      disabled: confirmation.companyDomains,
    },
  ] as const;

  return (
    <Card data-testid="email-confirmation-card">
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.emailConfirmation.title")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.emailConfirmation.lead")}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <form action={save} className="flex flex-col gap-3">
          <fieldset
            aria-label={t("admin.emailConfirmation.title")}
            className="flex flex-col gap-2.5"
          >
            {choices.map((choice) => (
              <label
                key={choice.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-control border border-line px-3 py-2.5 has-[:checked]:border-brand-line has-[:checked]:bg-brand-weak/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 hover:border-line-2"
              >
                <input
                  type="radio"
                  name="emailVerification"
                  value={choice.value}
                  defaultChecked={choice.value === confirmation.mode}
                  disabled={choice.disabled}
                  data-testid={`email-confirmation-${choice.value}`}
                  className="mt-0.5 size-4 flex-none accent-brand"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-ink">
                    {choice.title}
                  </span>
                  <span className="text-xs text-ink-3">{choice.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {confirmation.companyDomains ? (
            <p className="text-xs text-ink-3">
              {t("admin.emailConfirmation.heldByCompanyDomains")}
            </p>
          ) : null}
          <p
            className="text-xs text-ink-3"
            data-testid="email-confirmation-now"
          >
            {confirmation.required
              ? t("admin.emailConfirmation.nowRequired")
              : confirmation.linksCanArrive
                ? t("admin.emailConfirmation.nowNotRequired")
                : t("admin.emailConfirmation.nowNoMail")}
          </p>
          <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
            <Button type="submit" variant="primary" size="sm">
              {t("common.save")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
