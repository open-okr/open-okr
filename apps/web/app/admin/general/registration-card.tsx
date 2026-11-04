import {
  ACCESS_LEVELS,
  isCloudEnabled,
  REGISTRATION_POLICIES,
  type RegistrationPolicy,
  type SettingSource,
  setRegistrationPolicy,
} from "@openokr/core";
import { Button, Card, CardBody, CardHeader } from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { requireAccessLevel } from "../../../lib/access";
import { getPool } from "../../../lib/pool";
import { getKeyRing } from "../../../lib/secrets";
import { getTranslations } from "../../../lib/translations";

/**
 * Who may create an account on this instance (docs/design/
 * registration-policy.md §4).
 *
 * The policy was written once by the setup wizard and by nothing after it, so
 * opening registration meant editing the database by hand. The card mirrors
 * the instance name card beside it: `full` only, absent on a managed cloud,
 * and every change written to the instance audit chain.
 */

async function save(formData: FormData): Promise<void> {
  "use server";
  // Gated here as well as by the admin layout: a server action is directly
  // reachable, and a member below `full` gets the same not-found as the page.
  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const pool = getPool();
  // On a cloud the policy is the operator's, shared by every customer (D5).
  if (await isCloudEnabled(pool)) {
    return;
  }
  const chosen = String(formData.get("registrationPolicy") ?? "");
  const policy = REGISTRATION_POLICIES.find((one) => one === chosen);
  if (policy === undefined) {
    return;
  }
  await setRegistrationPolicy(pool, getKeyRing(), {
    policy,
    userId: access.userId,
    workspaceId: access.workspaceId,
  });
  // The sign-up page reads the policy per request; this card is the only
  // other place that shows it.
  revalidatePath("/admin/general");
}

/** Each choice's title and line, in the order the card offers them. */
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

export async function RegistrationCard({
  policy,
  source,
}: {
  readonly policy: RegistrationPolicy;
  readonly source: SettingSource;
}) {
  const { t } = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.general.registration.title")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.general.registration.lead")}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <form action={save} className="flex flex-col gap-3">
          <fieldset
            aria-label={t("admin.general.registration.title")}
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
                  data-testid={`registration-${choice.value}`}
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
          <p className="text-xs text-ink-3" data-testid="registration-source">
            {source === "database"
              ? t("admin.general.registration.fromHere")
              : source === "environment"
                ? t("admin.general.registration.fromVariable")
                : t("admin.general.registration.fromDefault")}
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
