import { callAction, OperationError } from "@openokr/core";
import { Button, Card, CardBody } from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * The branding admin card (screen S-36, P2-T08). One field today: the
 * primary colour. Empty means the product's own default theme, not an
 * unanswered question, so clearing the field is a valid save.
 *
 * **It really was a card, and it took until now to look like one** (P8-G08).
 * P2-T08 left this as `<p><label><br><input>` and two browser-default submit
 * buttons. Tailwind's reset strips an input's border, so the one setting on
 * this screen rendered as a line of grey placeholder text with no visible
 * field to type in, and the two buttons rendered as two lines of plain black
 * text. `general-settings-form.tsx` carried the identical defect and was
 * rebuilt; its own docstring says so. This card was the copy that pass missed,
 * and it is rebuilt here to the same pattern rather than to a new one.
 *
 * **One form, two actions.** Reset is a second submit button carrying its own
 * `formAction` rather than a second `<form>`, because a form cannot nest
 * inside another and the two controls belong on one row. The old markup used
 * two sibling forms, which is what stacked Save above Reset as though they
 * were a list rather than a primary action and its escape hatch.
 */

const INPUT_CLASS =
  "rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-sm font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-line";

const LABEL_CLASS =
  "flex w-full max-w-sm flex-col gap-1 text-xs font-semibold text-ink-2";

/**
 * What the settings schema accepts, repeated here on purpose.
 *
 * The same expression is the input's `pattern`, so the browser refuses a value
 * the server would refuse anyway and says so in place, rather than the save
 * appearing to work and quietly changing nothing. It also guards the swatch
 * below: a stored value reaches an inline `style`, and a colour that has not
 * been matched against this is a string from the database going into CSS.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

async function save(formData: FormData): Promise<void> {
  "use server";
  const { session, workspace } = await requireWorkspace();
  const primaryColor = String(formData.get("primaryColor") ?? "").trim();

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "settings.updateWorkspaceBranding",
      {
        branding: primaryColor === "" ? {} : { primaryColor },
      },
    );
  } catch (error) {
    if (!(error instanceof OperationError)) {
      throw error;
    }
    return;
  }
  revalidatePath("/admin/branding");
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
    { card: "branding" },
  );
  revalidatePath("/admin/branding");
}

export async function BrandingSettingsForm({
  branding,
}: {
  branding: Record<string, unknown>;
}) {
  const { t } = await getTranslations();

  const stored = String(branding.primaryColor ?? "");
  // Matched before it is used, never after. An unmatched value renders no
  // swatch at all rather than a swatch of something unknown.
  const swatch = HEX.test(stored) ? stored : null;

  return (
    <Card>
      <CardBody>
        <form action={save} className="flex flex-col gap-3">
          <label htmlFor="primaryColor" className={LABEL_CLASS}>
            {t("admin.branding.brandingSettingsForm.primaryColourHex")}
            <span className="flex items-center gap-2">
              <input
                id="primaryColor"
                name="primaryColor"
                placeholder="#336699"
                defaultValue={stored}
                pattern="#[0-9a-fA-F]{6}"
                title={t("admin.branding.brandingSettingsForm.sixHexDigits")}
                spellCheck={false}
                autoComplete="off"
                className={`${INPUT_CLASS} flex-1 font-mono`}
              />
              {/*
               * The colour in force, drawn rather than described. A hex code
               * is not something a person can picture, and this card exists to
               * choose one. `aria-hidden` because the value beside it is the
               * same fact in text: announcing it twice is noise, and a colour
               * is not information a screen reader can convey anyway.
               */}
              <span
                aria-hidden
                className="size-7 flex-none rounded-control border border-line-2"
                style={swatch ? { backgroundColor: swatch } : undefined}
              />
            </span>
          </label>
          <p className="max-w-sm text-xs text-ink-3">
            {swatch === null
              ? t("admin.branding.brandingSettingsForm.emptyIsTheDefault")
              : t("admin.branding.brandingSettingsForm.inForce", {
                  colour: swatch,
                })}
          </p>
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
