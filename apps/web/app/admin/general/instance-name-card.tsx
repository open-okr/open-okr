import {
  ACCESS_LEVELS,
  INSTANCE_NAME_MAX_LENGTH,
  InstanceNameError,
  isCloudEnabled,
  renameInstance,
  type SettingSource,
} from "@openokr/core";
import { Button, Card, CardBody, CardHeader } from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { requireAccessLevel } from "../../../lib/access";
import { getPool } from "../../../lib/pool";
import { getKeyRing } from "../../../lib/secrets";
import { getTranslations } from "../../../lib/translations";

/**
 * What this instance calls itself (completeness review M-33).
 *
 * `instance.name` could be set by the wizard and by `OPENOKR_INSTANCE_NAME`,
 * and by nothing after setup. This is the "instance administration" §4.14
 * names as the setting's home after the wizard.
 *
 * **Absent on a managed cloud**, the same rule the layout applies to its
 * cloud-only cards in reverse: there the name belongs to the operator and is
 * shared by every customer, so no one customer's administrator may change it.
 * The action refuses it as well, because a server action is reachable
 * whatever the page rendered.
 *
 * **It says what does not follow at once.** Better Auth reads the two-factor
 * issuer and the passkey name when it starts, so an authenticator app and a
 * passkey prompt show a new name after a restart. Everything else follows on
 * the next page, email and nudge.
 */

const INPUT_CLASS =
  "rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-sm font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-line";

async function rename(formData: FormData): Promise<void> {
  "use server";
  // Gated here as well as by the admin layout: a server action is directly
  // reachable, and a member below `full` gets the same not-found as the page.
  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const pool = getPool();
  if (await isCloudEnabled(pool)) {
    return;
  }

  try {
    await renameInstance(pool, getKeyRing(), {
      name: String(formData.get("instanceName") ?? ""),
      userId: access.userId,
      workspaceId: access.workspaceId,
    });
  } catch (error) {
    // Only a name over the limit is refused, and the field's own maxLength
    // stops a browser sending one. Fails quietly like the card above it.
    if (!(error instanceof InstanceNameError)) {
      throw error;
    }
    return;
  }
  // Every screen carries the name, starting with the tab title the root
  // layout sets, so the whole tree is stale rather than this one page.
  revalidatePath("/", "layout");
}

export async function InstanceNameCard({
  name,
  source,
  deploymentName,
}: {
  readonly name: string;
  readonly source: SettingSource;
  /** What clearing the field goes back to: the variable, or "OpenOKR". */
  readonly deploymentName: string;
}) {
  const { t } = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">
          {t("admin.general.instanceName.title")}
        </h2>
      </CardHeader>
      <CardBody>
        <form action={rename} className="flex flex-col gap-3">
          <label
            htmlFor="instanceName"
            className="flex w-full max-w-sm flex-col gap-1 text-xs font-semibold text-ink-2"
          >
            {t("admin.general.instanceName.label")}
            <input
              id="instanceName"
              name="instanceName"
              defaultValue={name}
              maxLength={INSTANCE_NAME_MAX_LENGTH}
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </label>
          <p className="text-xs text-ink-3">
            {t("admin.general.instanceName.hint")}
          </p>
          <p className="text-xs text-ink-3">
            {source === "database"
              ? t("admin.general.instanceName.fromHere", { deploymentName })
              : t("admin.general.instanceName.fromDeployment")}
          </p>
          <p className="text-xs text-ink-3">
            {t("admin.general.instanceName.restart")}
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
