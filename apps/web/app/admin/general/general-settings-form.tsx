import { callAction, OperationError } from "@openokr/core";
import { Button, Card, CardBody } from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * The general admin card (screen S-36, P2-T08): timezone, language and
 * trusted email domains, one save for the whole card. A refusal fails quietly
 * rather than rendering a stack trace, the same tradeoff
 * `rename-workspace.tsx` already makes.
 *
 * **It really was a card, and it took until now to look like one.** P2-T08
 * left this as three `<p><label><br><input>` groups and two browser-default
 * submit buttons, and Tailwind's reset strips an input's border, so the three
 * settings rendered as bare text with no visible field to type in. The state
 * card directly below it has been drawn properly since P6-G25, which is what
 * made the difference obvious.
 *
 * **One form, two actions.** Reset is a second submit button carrying its own
 * `formAction` rather than a second `<form>`, because a form cannot nest
 * inside another and the two controls belong on one row.
 */

const INPUT_CLASS =
  "rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-sm font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-line";

const LABEL_CLASS =
  "flex w-full max-w-sm flex-col gap-1 text-xs font-semibold text-ink-2";

async function save(formData: FormData): Promise<void> {
  "use server";
  const { session, workspace } = await requireWorkspace();

  const timezone = String(formData.get("timezone") ?? "").trim();
  const language = String(formData.get("language") ?? "").trim();
  const trustedEmailDomains = String(formData.get("trustedEmailDomains") ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "settings.updateWorkspaceGeneral",
      {
        timezone: timezone === "" ? undefined : timezone,
        language: language === "" ? undefined : language,
        trustedEmailDomains,
      },
    );
  } catch (error) {
    if (!(error instanceof OperationError)) {
      throw error;
    }
    return;
  }
  revalidatePath("/admin/general");
}

async function reset(): Promise<void> {
  "use server";
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "settings.resetWorkspaceSettings",
    { card: "general" },
  );
  revalidatePath("/admin/general");
}

export async function GeneralSettingsForm({
  settings,
}: {
  settings: Record<string, unknown>;
}) {
  const { t } = await getTranslations();

  const trustedEmailDomains = Array.isArray(settings.trustedEmailDomains)
    ? (settings.trustedEmailDomains as string[]).join(", ")
    : "";

  return (
    <Card>
      <CardBody>
        <form action={save} className="flex flex-col gap-3">
          <label htmlFor="timezone" className={LABEL_CLASS}>
            {t("common.timezone")}
            <input
              id="timezone"
              name="timezone"
              defaultValue={String(settings.timezone ?? "")}
              className={INPUT_CLASS}
            />
          </label>
          <label htmlFor="language" className={LABEL_CLASS}>
            {t("admin.general.generalSettingsForm.language")}
            <input
              id="language"
              name="language"
              defaultValue={String(settings.language ?? "")}
              className={INPUT_CLASS}
            />
          </label>
          <label htmlFor="trustedEmailDomains" className={LABEL_CLASS}>
            {t("admin.general.generalSettingsForm.trustedEmailDomainsComma")}
            <input
              id="trustedEmailDomains"
              name="trustedEmailDomains"
              defaultValue={trustedEmailDomains}
              className={INPUT_CLASS}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
            <Button type="submit" variant="primary" size="sm">
              {t("common.save")}
            </Button>
            <Button type="submit" formAction={reset} variant="ghost" size="sm">
              {t("common.resetToDefaults")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
