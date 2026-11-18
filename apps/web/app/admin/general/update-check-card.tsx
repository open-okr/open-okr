import { ACCESS_LEVELS, isCloudEnabled, setUpdateCheck } from "@openokr/core";
import { CardHeader } from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { requireAccessLevel } from "../../../lib/access";
import { RUNNING_VERSION } from "../../../lib/app-version";
import { getPool } from "../../../lib/pool";
import { getKeyRing } from "../../../lib/secrets";
import { SettingsFormCard } from "../../../lib/settings-form-card";
import { getTranslations } from "../../../lib/translations";

/**
 * The switch for the update check (docs/design/version-footer.md §4).
 *
 * **Absent on a managed cloud**, like the instance name card: the operator
 * upgrades there, and the check never runs. The action refuses it as well,
 * because a server action is reachable whatever the page rendered.
 */

async function save(formData: FormData): Promise<void> {
  "use server";
  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const pool = getPool();
  if (await isCloudEnabled(pool)) {
    return;
  }
  await setUpdateCheck(pool, getKeyRing(), {
    enabled: formData.get("updateCheck") === "on",
    userId: access.userId,
    workspaceId: access.workspaceId,
  });
  // The footer on every screen reads it.
  revalidatePath("/", "layout");
}

export async function UpdateCheckCard({
  enabled,
}: {
  readonly enabled: boolean;
}) {
  const { t } = await getTranslations();

  return (
    <SettingsFormCard
      formId="update-check-form"
      testId="update-check-card"
      unsavedLabel={t("admin.general.updateCheck.title")}
      action={save}
      header={
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">
            {t("admin.general.updateCheck.title")}
          </h2>
        </CardHeader>
      }
    >
      <label className="col-span-12 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="updateCheck"
          defaultChecked={enabled}
          className="size-4"
        />
        {t("admin.general.updateCheck.label")}
      </label>
      <p className="col-span-12 text-xs text-ink-3">
        {t("admin.general.updateCheck.hint", { version: RUNNING_VERSION })}
      </p>
    </SettingsFormCard>
  );
}
