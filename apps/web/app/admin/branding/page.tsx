import { callAction, deriveBrandPalette } from "@openokr/core";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import {
  BrandingSettingsForm,
  type BrandingStatus,
} from "./branding-settings-form";

/**
 * Matched before a stored value is used, never after. It reaches an inline
 * `style` as the swatch, and a colour that has not been matched against this
 * is a string from the database going into CSS.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

export default async function BrandingSettingsPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const read = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "settings.readWorkspaceSettings",
    {},
  );

  // Worked out with the same function the root layout applies, so what the
  // card says is in force is what every screen is drawn in (M-14).
  const branding = (read.settings.branding as Record<string, unknown>) ?? {};
  const colour = String(branding.primaryColor ?? "");
  const stored = HEX.test(colour) ? colour : null;
  const palette = stored === null ? null : deriveBrandPalette(stored);
  const status: BrandingStatus = {
    stored,
    fill: palette?.fill ?? null,
    adjusted: palette?.adjusted ?? false,
  };

  return (
    <>
      <h1 className="text-lg font-bold text-ink">
        {t("admin.branding.branding")}
      </h1>
      <BrandingSettingsForm status={status} />
    </>
  );
}
