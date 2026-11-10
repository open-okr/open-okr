import {
  REGISTRATION_POLICIES,
  type RegistrationOrigin,
  type RegistrationPolicy,
  setRegistrationPolicyAsOperator,
} from "@openokr/core";
import { Button, Card, CardBody, CardHeader } from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { getKeyRing } from "../../../lib/secrets";
import { getTranslations } from "../../../lib/translations";

/**
 * Who may create an account on this cloud (registration-policy.md §9.3,
 * plan 0.7.0 B1).
 *
 * On a cloud the Registration card on Admin, General is hidden, because the
 * policy is the operator's rather than any one customer's, and until 0.7.0 no
 * screen offered it at all. The setup wizard's `invite_only` closed a cloud
 * behind its first account and nothing could reopen it. The grant is
 * re-checked in the action, because a server action is reachable whatever the
 * page rendered.
 */

async function save(formData: FormData): Promise<void> {
  "use server";
  const operator = await requireOperator();
  const chosen = String(formData.get("registrationPolicy") ?? "");
  const policy = REGISTRATION_POLICIES.find((one) => one === chosen);
  if (policy === undefined) {
    return;
  }
  await setRegistrationPolicyAsOperator(getPool(), getKeyRing(), {
    policy,
    operatorUserId: operator.userId,
  });
  revalidatePath("/operator/instance");
}

const CHOICES: readonly {
  readonly value: RegistrationPolicy;
  readonly title: string;
  readonly hint: string;
}[] = [
  {
    value: "invite_only",
    title: "admin.general.registration.inviteOnly",
    hint: "admin.general.registration.inviteOnlyHint",
  },
  {
    value: "company_domains",
    title: "admin.general.registration.company",
    hint: "admin.general.registration.companyHint",
  },
  {
    value: "open",
    title: "admin.general.registration.anyone",
    hint: "admin.general.registration.anyoneHint",
  },
];

const ORIGIN_LINE: Record<RegistrationOrigin, string> = {
  operator: "operator.instance.registration.fromOperator",
  wizard: "operator.instance.registration.fromWizard",
  admin: "operator.instance.registration.fromAdmin",
  environment: "operator.instance.registration.fromVariable",
  default: "operator.instance.registration.fromDefault",
};

export async function OperatorRegistrationCard({
  policy,
  origin,
}: {
  /** The policy in force: on a cloud with nothing chosen, open. */
  readonly policy: RegistrationPolicy;
  readonly origin: RegistrationOrigin;
}) {
  const { t } = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-bold text-ink">
            {t("operator.instance.registration.title")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("operator.instance.registration.lead")}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <form action={save} className="flex flex-col gap-3">
          <fieldset
            aria-label={t("operator.instance.registration.title")}
            className="flex flex-col gap-2.5"
          >
            {CHOICES.map((choice) => (
              <label
                key={choice.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-control border border-line px-3 py-2.5 has-[:checked]:border-brand-line has-[:checked]:bg-brand-weak/40 hover:border-line-2"
              >
                <input
                  type="radio"
                  name="registrationPolicy"
                  value={choice.value}
                  defaultChecked={choice.value === policy}
                  className="mt-0.5 size-4 flex-none accent-brand"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-ink">
                    {t(choice.title)}
                  </span>
                  <span className="text-xs text-ink-3">{t(choice.hint)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p
            className="text-xs text-ink-3"
            data-testid="operator-registration-source"
          >
            {t(ORIGIN_LINE[origin])}
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
